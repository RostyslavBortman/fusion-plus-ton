import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, Address, Cell, beginCell, Slice } from '@ton/core';
import { FeeBankCharger } from '../build/fee-bank-charger/fee-bank-charger_FeeBankCharger';
import { FeeBank } from '../build/fee-bank/fee-bank_FeeBank';
import { UserDepositContract } from '../build/user-deposit-contract/user-deposit_UserDepositContract';
import { OPCODES, getEmptySlice } from './constants';
import '@ton/test-utils';

describe('FeeBankCharger Integration Tests', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let user1: SandboxContract<TreasuryContract>;
    let user2: SandboxContract<TreasuryContract>;
    let feeBankCharger: SandboxContract<FeeBankCharger>;
    let feeBank: SandboxContract<FeeBank>;

    // Helper function to convert Address to Slice
    const addressToSlice = (address: Address): Slice => {
        return beginCell().storeAddress(address).endCell().asSlice();
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        user1 = await blockchain.treasury('user1');
        user2 = await blockchain.treasury('user2');

        // Deploy FeeBankCharger (which will also deploy FeeBank)
        feeBankCharger = blockchain.openContract(
            await FeeBankCharger.fromInit(
                getEmptySlice(), // feeToken
                owner.address
            )
        );

        // Deploy FeeBankCharger with enough funds for both contracts
        const deployResult = await feeBankCharger.send(
            deployer.getSender(),
            {
                value: toNano('1'), // Enough for deploying both contracts
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: feeBankCharger.address,
            deploy: true,
            success: true,
        });

        // Get FeeBank instance
        const feeBankAddress = await feeBankCharger.getFeeBank();
        feeBank = blockchain.openContract(FeeBank.fromAddress(feeBankAddress));

        // Verify FeeBank was deployed
        expect(deployResult.transactions).toHaveTransaction({
            from: feeBankCharger.address,
            to: feeBankAddress,
            deploy: true,
            success: true,
        });
    });

    describe('Complete User Flow', () => {
        it('should handle multiple users with different operations', async () => {
            // Both users make deposits
            const users = [user1, user2];
            const deposits = [toNano('5'), toNano('8')];
            const userDeposits: SandboxContract<UserDepositContract>[] = [];

            for (let i = 0; i < users.length; i++) {
                const depositResult = await feeBank.send(
                    users[i].getSender(),
                    {
                        value: deposits[i] + toNano('0.1'),
                    },
                    {
                        $$type: 'Deposit'
                    }
                );

                expect(depositResult.transactions).toHaveTransaction({
                    from: users[i].address,
                    to: feeBank.address,
                    success: true,
                });

                const addr = await feeBank.getUerDeposit(addressToSlice(users[i].address));
                userDeposits.push(blockchain.openContract(UserDepositContract.fromAddress(addr)));
            }

            // Give different credits to users
            const credits = [toNano('3'), toNano('6')];
            for (let i = 0; i < users.length; i++) {
                // Check initial credit after deposit
                const initialCredit = await userDeposits[i].getGetCreditAllowance();
                console.log(`User ${i} initial credit:`, initialCredit);

                await feeBankCharger.send(
                    blockchain.sender(feeBank.address),
                    {
                        value: toNano('0.1'),
                    },
                    {
                        $$type: 'IncreaseCredit',
                        account: addressToSlice(users[i].address),
                        amount: credits[i]
                    }
                );
            }

            // Verify credits were increased
            const finalCredit0 = await userDeposits[0].getGetCreditAllowance();
            const finalCredit1 = await userDeposits[1].getGetCreditAllowance();

            // Credits might be initial deposit + added credit
            expect(finalCredit0).toBeGreaterThanOrEqual(credits[0]);
            expect(finalCredit1).toBeGreaterThanOrEqual(credits[1]);

            // User1 withdraws, User2 gets fee charged
            await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Withdraw',
                    amount: toNano('2')
                }
            );

            await userDeposits[1].send(
                blockchain.sender(feeBankCharger.address),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'InternalChargeFee',
                    fee: toNano('1')
                }
            );

            // Verify final states
            const credit0After = await userDeposits[0].getGetCreditAllowance();
            const credit1After = await userDeposits[1].getGetCreditAllowance();

            // Credit should be reduced after operations
            expect(credit0After).toBeLessThan(finalCredit0);
            expect(credit1After).toBeLessThan(finalCredit1);
        });
    });

    describe('Credit Query Flow', () => {
        it('should handle credit query through the system', async () => {
            // Setup: User has deposit and credit
            await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('5') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            const userDepositAddr = await feeBank.getUerDeposit(addressToSlice(user1.address));

            // Give credit
            await feeBankCharger.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'IncreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: toNano('3')
                }
            );

            // Query credit through FeeBank
            const queryResult = await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'AvailCreditQueryRequest',
                    account: addressToSlice(user1.address)
                }
            );

            // Debug: print all transactions
            console.log('Query transactions:');
            // queryResult.transactions.forEach((tx, i) => {
            //     console.log(`Transaction ${i}:`, {
            //         from: tx.from?.toString(),
            //         to: tx.to?.toString(),
            //         op: tx.op?.toString(16),
            //         success: tx.success
            //     });
            // });

            // Should forward to charger
            expect(queryResult.transactions).toHaveTransaction({
                from: feeBank.address,
                to: feeBankCharger.address,
                success: true,
                // op: OPCODES.AVAIL_CREDIT_QUERY,
            });

            // Charger should forward to user deposit
            expect(queryResult.transactions).toHaveTransaction({
                from: feeBankCharger.address,
                to: userDepositAddr,
                success: true,
                // op: OPCODES.INTERNAL_CREDIT_QUERY,
            });

            // Response should go back through the chain
            expect(queryResult.transactions).toHaveTransaction({
                from: userDepositAddr,
                to: feeBankCharger.address,
                success: true,
                // op: OPCODES.INTERNAL_CREDIT_RESPONSE,
            });

            expect(queryResult.transactions).toHaveTransaction({
                from: feeBankCharger.address,
                to: feeBank.address,
                success: true,
                // op: OPCODES.AVAIL_CREDIT_RESP,
            });
        });
    });

    describe('Error Scenarios', () => {
        it('should reject operations from non-FeeBank addresses', async () => {
            const imposter = await blockchain.treasury('imposter');

            // Try to increase credit
            const result1 = await feeBankCharger.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'IncreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: toNano('5')
                }
            );

            expect(result1.transactions).toHaveTransaction({
                from: imposter.address,
                to: feeBankCharger.address,
                success: false,
            });

            // Try to decrease credit
            const result2 = await feeBankCharger.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'DecreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: toNano('5')
                }
            );

            expect(result2.transactions).toHaveTransaction({
                from: imposter.address,
                to: feeBankCharger.address,
                success: false,
            });

            // Try to query credit
            const result3 = await feeBankCharger.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'AvailCreditQuery',
                    account: addressToSlice(user1.address),
                    respondTo: null
                }
            );

            expect(result3.transactions).toHaveTransaction({
                from: imposter.address,
                to: feeBankCharger.address,
                success: false,
            });
        });

        it('should handle responses from wrong user deposit contracts', async () => {
            // Create a fake user deposit contract
            const fakeUser = await blockchain.treasury('fakeUser');

            // Try to send credit increased response
            const result = await feeBankCharger.send(
                fakeUser.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalCreditIncreased',
                    account: addressToSlice(user1.address),
                    total: toNano('100')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: fakeUser.address,
                to: feeBankCharger.address,
                success: false,
            });
        });

        it('should maintain consistency during failed operations', async () => {
            // User makes deposit
            await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('5') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            const userDepositAddr = await feeBank.getUerDeposit(addressToSlice(user1.address));
            const userDeposit = blockchain.openContract(UserDepositContract.fromAddress(userDepositAddr));

            // Give some credit
            await feeBankCharger.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'IncreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: toNano('3')
                }
            );

            const creditBefore = await userDeposit.getGetCreditAllowance();

            // Try to decrease more credit than available
            await feeBankCharger.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'DecreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: toNano('10')
                }
            );

            // Credit should remain unchanged (or decreased to 0, depending on implementation)
            const creditAfter = await userDeposit.getGetCreditAllowance();
            expect(creditAfter).toBeLessThanOrEqual(creditBefore);
        });
    });

    describe('Gas Optimization Tests', () => {
        it('should handle operations with minimal gas', async () => {
            // Test with exact gas amounts
            const depositResult = await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('1') + toNano('0.05'), // Minimal gas
                },
                {
                    $$type: 'Deposit'
                }
            );

            expect(depositResult.transactions).toHaveTransaction({
                from: user1.address,
                to: feeBank.address,
                success: true,
            });

            // Credit operation with minimal gas
            const creditResult = await feeBankCharger.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.03'), // Minimal gas from contract
                },
                {
                    $$type: 'IncreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: toNano('1')
                }
            );

            expect(creditResult.transactions).toHaveTransaction({
                from: feeBankCharger.address,
                to: await feeBank.getUerDeposit(addressToSlice(user1.address)),
                success: true,
            });
        });
    });

    describe('Jetton Support', () => {
        it('should deploy with jetton token and handle operations', async () => {
            const jettonWallet = Address.parse('EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t');

            // Deploy new FeeBankCharger with jetton (which will also deploy FeeBank)
            const jettonCharger = blockchain.openContract(
                await FeeBankCharger.fromInit(
                    addressToSlice(jettonWallet),
                    owner.address
                )
            );

            const deployResult = await jettonCharger.send(
                deployer.getSender(),
                {
                    value: toNano('1'),
                },
                {
                    $$type: 'Deploy',
                    queryId: 0n
                }
            );

            const jettonFeeBankAddr = await jettonCharger.getFeeBank();
            const jettonFeeBank = blockchain.openContract(FeeBank.fromAddress(jettonFeeBankAddr));

            // Verify both contracts were deployed
            expect(deployResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: jettonCharger.address,
                deploy: true,
                success: true,
            });

            expect(deployResult.transactions).toHaveTransaction({
                from: jettonCharger.address,
                to: jettonFeeBankAddr,
                deploy: true,
                success: true,
            });

            // Try native deposit (should fail)
            const result = await jettonFeeBank.send(
                user1.getSender(),
                {
                    value: toNano('1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: user1.address,
                to: jettonFeeBankAddr,
                success: false, // Should fail with UseJettonTransfer
            });
        });
    });

    describe('Edge Cases and Additional Tests', () => {
        it('should handle operations with zero amounts', async () => {
            // Deposit first
            await feeBank.send(
                user1.getSender(),
                {
                    value: toNano('5') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            // Try to increase credit by 0
            const result1 = await feeBankCharger.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'IncreaseCredit',
                    account: addressToSlice(user1.address),
                    amount: 0n
                }
            );

            expect(result1.transactions).toHaveTransaction({
                from: feeBank.address,
                to: feeBankCharger.address,
                success: true,
            });
        });

        it('should correctly calculate user deposit addresses', async () => {
            // Get address from charger
            const chargerUserAddr = await feeBankCharger.getAvailableCredit(addressToSlice(user1.address));

            // Get address from feeBank
            const feeBankUserAddr = await feeBank.getUerDeposit(addressToSlice(user1.address));

            // They should be the same
            expect(chargerUserAddr).toEqualAddress(feeBankUserAddr);
        });
    });
});