import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, Address, Cell, beginCell, Slice } from '@ton/core';
import { FeeBank } from '../build/fee-bank/fee-bank_FeeBank';
import '@ton/test-utils';

describe('FeeBank', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let charger: SandboxContract<TreasuryContract>;
    let feeBank: SandboxContract<FeeBank>;

    // Helper function to convert Address to Slice
    const addressToSlice = (address: Address): Slice => {
        return beginCell().storeAddress(address).endCell().asSlice();
    };

    // Test constants
    const EMPTY_SLICE = beginCell().endCell().asSlice(); // Native TON
    const JETTON_WALLET = Address.parse('EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t'); // Mock jetton wallet

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        charger = await blockchain.treasury('charger');

        // Deploy FeeBank with native TON as fee token
        feeBank = blockchain.openContract(
            await FeeBank.fromInit(
                EMPTY_SLICE,
                addressToSlice(charger.address),
                addressToSlice(owner.address)
            )
        );

        const deployResult = await feeBank.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: feeBank.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy correctly', async () => {
        // Check initial state
        expect(await feeBank.getTotalFeesCollected()).toBe(0n);
        expect(await feeBank.getPendingGatherCount()).toBe(0n);
    });

    describe('Native TON Deposits', () => {
        it('should handle direct deposit', async () => {
            const user = await blockchain.treasury('user');
            const depositAmount = toNano('5');

            const result = await feeBank.send(
                user.getSender(),
                {
                    value: depositAmount + toNano('0.1'), // deposit + gas
                },
                {
                    $$type: 'Deposit'
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: feeBank.address,
                success: true,
            });

            // Check that user deposit contract was deployed
            const userDepositAddr = await feeBank.getUerDeposit(addressToSlice(user.address));
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDepositAddr,
                deploy: true,
            });
        });

        it('should handle deposit for another account', async () => {
            const depositor = await blockchain.treasury('depositor');
            const beneficiary = await blockchain.treasury('beneficiary');
            const depositAmount = toNano('3');

            const result = await feeBank.send(
                depositor.getSender(),
                {
                    value: depositAmount + toNano('0.1'),
                },
                {
                    $$type: 'DepositFor',
                    account: addressToSlice(beneficiary.address)
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: depositor.address,
                to: feeBank.address,
                success: true,
            });

            // Check that beneficiary's deposit contract was deployed
            const userDepositAddr = await feeBank.getUerDeposit(addressToSlice(beneficiary.address));
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDepositAddr,
                deploy: true,
            });
        });
    });

    describe('Withdrawals', () => {
        let user: SandboxContract<TreasuryContract>;

        beforeEach(async () => {
            // Setup: make a deposit first
            user = await blockchain.treasury('user');
            const depositAmount = toNano('10');

            await feeBank.send(
                user.getSender(),
                {
                    value: depositAmount + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );
        });

        it('should handle withdrawal to self', async () => {
            const withdrawAmount = toNano('3');

            const result = await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Withdraw',
                    amount: withdrawAmount
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: feeBank.address,
                success: true,
            });

            // Should notify charger about credit decrease
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: charger.address,
                success: true,
            });
        });

        it('should handle withdrawal to another account', async () => {
            const recipient = await blockchain.treasury('recipient');
            const withdrawAmount = toNano('2');

            const result = await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'WithdrawTo',
                    account: addressToSlice(recipient.address),
                    amount: withdrawAmount
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: feeBank.address,
                success: true,
            });
        });
    });

    describe('Fee Collection', () => {
        it('should only allow owner to gather fees', async () => {
            const notOwner = await blockchain.treasury('notOwner');

            // Create accounts cell
            const accountsCell = beginCell()
                .storeRef(
                    beginCell().storeAddress(notOwner.address).endCell()
                )
                .endCell();

            const result = await feeBank.send(
                notOwner.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'GatherFees',
                    accounts: accountsCell
                }
            );

            // Should fail with OnlyOwner error
            expect(result.transactions).toHaveTransaction({
                from: notOwner.address,
                to: feeBank.address,
                success: false,
            });
        });

        it('should process fee gathering for multiple accounts', async () => {
            const user1 = await blockchain.treasury('user1');
            const user2 = await blockchain.treasury('user2');

            // Setup: create deposits for both users
            await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('5') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            await feeBank.send(
                user2.getSender(),
                {
                    value: toNano('7') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            // Create accounts cell with both users
            const accountsCell = beginCell()
                .storeRef(beginCell().storeAddress(user1.address).endCell())
                .storeRef(beginCell().storeAddress(user2.address).endCell())
                .endCell();

            const result = await feeBank.send(
                owner.getSender(),
                {
                    value: toNano('0.5'),
                },
                {
                    $$type: 'GatherFees',
                    accounts: accountsCell
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: feeBank.address,
                success: true,
            });

            // Should query credit for both accounts
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: charger.address,
                success: true,
            });

            // Pending gather count should be 2
            expect(await feeBank.getPendingGatherCount()).toBe(2n);
        });
    });

    describe('Credit Management', () => {
        it('should handle credit queries', async () => {
            const user = await blockchain.treasury('user');
            const requester = await blockchain.treasury('requester');

            const result = await feeBank.send(
                requester.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'AvailCreditQueryRequest',
                    account: addressToSlice(user.address)
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: requester.address,
                to: feeBank.address,
                success: true,
            });

            // Should forward query to charger
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: charger.address,
                success: true,
            });
        });

        it('should only accept credit responses from charger', async () => {
            const imposter = await blockchain.treasury('imposter');
            const user = await blockchain.treasury('user');

            const result = await feeBank.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'AvailCreditResp',
                    credit: toNano('100'),
                    account: addressToSlice(user.address)
                }
            );

            // Should fail with OnlyCharger error
            expect(result.transactions).toHaveTransaction({
                from: imposter.address,
                to: feeBank.address,
                success: false,
            });
        });
    });

    describe('Rescue Funds', () => {
        it('should only allow owner to rescue funds', async () => {
            const notOwner = await blockchain.treasury('notOwner');

            const result = await feeBank.send(
                notOwner.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'RescueFunds',
                    token: EMPTY_SLICE,
                    amount: toNano('1')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: notOwner.address,
                to: feeBank.address,
                success: false,
            });
        });
    });

    describe('Jetton Support', () => {
        let jettonFeeBank: SandboxContract<FeeBank>;

        beforeEach(async () => {
            // Deploy FeeBank with jetton as fee token
            jettonFeeBank = blockchain.openContract(
                await FeeBank.fromInit(
                    addressToSlice(JETTON_WALLET),
                    addressToSlice(charger.address),
                    addressToSlice(owner.address)
                )
            );

            await jettonFeeBank.send(
                deployer.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Deploy',
                    queryId: 0n
                }
            );
        });

        it('should reject native TON deposits when using jettons', async () => {
            const user = await blockchain.treasury('user');

            const result = await jettonFeeBank.send(
                user.getSender(),
                {
                    value: toNano('5'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            // Should fail with UseJettonTransfer error
            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: jettonFeeBank.address,
                success: false,
            });
        });

        it('should handle jetton transfers', async () => {
            const user = await blockchain.treasury('user');
            const jettonAmount = toNano('100');

            // Simulate jetton transfer from the configured jetton wallet
            const result = await jettonFeeBank.send(
                blockchain.sender(JETTON_WALLET),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'JettonTransfer',
                    query_id: 12345n,
                    amount: jettonAmount,
                    destination: jettonFeeBank.address,
                    response_destination: user.address,
                    custom_payload: null,
                    forward_ton_amount: 1n,
                    forward_payload: beginCell().endCell().asSlice()
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: JETTON_WALLET,
                to: jettonFeeBank.address,
                success: true,
            });

            // Should deploy user deposit contract
            const userDepositAddr = await jettonFeeBank.getUerDeposit(addressToSlice(user.address));
            expect(result.transactions).toHaveTransaction({
                from: jettonFeeBank.address,
                to: userDepositAddr,
                deploy: true,
            });
        });
    });
});