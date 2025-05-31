import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, Address, Cell, beginCell, Slice } from '@ton/core';
import { FeeBank } from '../build/fee-bank/fee-bank_FeeBank';
import { UserDepositContract } from '../build/user-deposit-contract/user-deposit_UserDepositContract';
import { OPCODES, getEmptySlice } from './constants';
import '@ton/test-utils';

describe('UserDepositContract', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let charger: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let feeBank: SandboxContract<FeeBank>;
    let userDeposit: SandboxContract<UserDepositContract>;
    let initialDeposit: bigint;

    // Helper function to convert Address to Slice
    const addressToSlice = (address: Address): Slice => {
        return beginCell().storeAddress(address).endCell().asSlice();
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        charger = await blockchain.treasury('charger');
        user = await blockchain.treasury('user');

        // Deploy FeeBank first
        feeBank = blockchain.openContract(
            await FeeBank.fromInit(
                getEmptySlice(),
                addressToSlice(charger.address),
                addressToSlice(owner.address)
            )
        );

        await feeBank.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        // Create UserDepositContract through FeeBank by making a deposit
        const depositAmount = toNano('5');
        const gasAmount = toNano('0.1');
        const depositResult = await feeBank.send(
            user.getSender(),
            {
                value: depositAmount + gasAmount,
            },
            {
                $$type: 'Deposit'
            }
        );

        // Get the deployed UserDeposit contract address
        const userDepositAddr = await feeBank.getUerDeposit(addressToSlice(user.address));
        userDeposit = blockchain.openContract(UserDepositContract.fromAddress(userDepositAddr));

        expect(depositResult.transactions).toHaveTransaction({
            from: feeBank.address,
            to: userDepositAddr,
            deploy: true,
            success: true,
        });

        // Get actual initial deposit (it includes gas that wasn't spent)
        initialDeposit = await userDeposit.getGetDeposit();
    });

    it('should be deployed with correct initial state', async () => {
        // Check that deposit was recorded (approximately 5.1 TON due to remaining gas)
        expect(initialDeposit).toBeGreaterThan(toNano('5'));
        expect(initialDeposit).toBeLessThan(toNano('5.2'));
        expect(await userDeposit.getGetCreditAllowance()).toBe(0n);
        expect(await userDeposit.getGetParent()).toEqualAddress(feeBank.address);
        expect(await userDeposit.getGetCharger()).toEqualAddress(charger.address);
    });

    describe('Deposits from FeeBank', () => {
        it('should handle additional deposits', async () => {
            const additionalDeposit = toNano('3');
            const previousBalance = await userDeposit.getGetDeposit();

            // Make another deposit through FeeBank
            const result = await feeBank.send(
                user.getSender(),
                {
                    value: additionalDeposit + toNano('0.1'),
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

            // Check that balance increased by approximately the deposit amount
            const newBalance = await userDeposit.getGetDeposit();
            const increase = newBalance - previousBalance;
            expect(increase).toBeGreaterThan(additionalDeposit);
            expect(increase).toBeLessThan(additionalDeposit + toNano('0.2'));
        });

        it('should reject direct deposits not from FeeBank', async () => {
            const imposter = await blockchain.treasury('imposter');

            const result = await userDeposit.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalDeposit',
                    amount: toNano('5')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: imposter.address,
                to: userDeposit.address,
                success: false,
            });
        });

        it('should handle multiple deposits correctly', async () => {
            const deposits = [toNano('1'), toNano('2'), toNano('0.5')];
            let totalDeposited = 0n;
            const startBalance = await userDeposit.getGetDeposit();

            for (const amount of deposits) {
                await feeBank.send(
                    user.getSender(),
                    {
                        value: amount + toNano('0.1'),
                    },
                    {
                        $$type: 'Deposit'
                    }
                );
                totalDeposited += amount;
            }

            const finalBalance = await userDeposit.getGetDeposit();
            const totalIncrease = finalBalance - startBalance;

            // Should be at least the sum of deposits
            expect(totalIncrease).toBeGreaterThan(totalDeposited);
            // But not too much more (accounting for gas)
            expect(totalIncrease).toBeLessThan(totalDeposited + toNano('0.5'));
        });

        it('should handle very small deposits', async () => {
            const smallDeposit = toNano('0.001'); // 0.001 TON
            const previousBalance = await userDeposit.getGetDeposit();

            const result = await feeBank.send(
                user.getSender(),
                {
                    value: smallDeposit + toNano('0.1'),
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

            const newBalance = await userDeposit.getGetDeposit();
            expect(newBalance).toBeGreaterThan(previousBalance);
        });
    });

    describe('Withdrawals through FeeBank', () => {
        it('should process withdrawal request', async () => {
            const withdrawAmount = toNano('2');

            // Withdraw through FeeBank
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

            // Check that charger was notified about credit decrease
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: charger.address,
                success: true,
                op: OPCODES.DECREASE_CREDIT,
            });

            // UserDeposit should receive withdrawal request
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                success: true,
                op: OPCODES.INTERNAL_WITHDRAW,
            });
        });

        it('should reject withdrawal exceeding balance', async () => {
            // Try to withdraw more than deposited
            const result = await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Withdraw',
                    amount: toNano('10') // Only ~5 TON deposited
                }
            );

            // The transaction to FeeBank succeeds
            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: feeBank.address,
                success: true,
            });

            // But UserDeposit should reject it
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                op: OPCODES.INTERNAL_WITHDRAW,
                success: false,
            });
        });

        it('should handle exact balance withdrawal', async () => {
            const currentBalance = await userDeposit.getGetDeposit();

            // Try to withdraw exact balance
            const result = await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Withdraw',
                    amount: currentBalance
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                success: true,
                op: OPCODES.INTERNAL_WITHDRAW,
            });

            // Balance should be 0 after withdrawal
            const finalBalance = await userDeposit.getGetDeposit();
            expect(finalBalance).toBe(0n);
        });

        it('should reject withdrawal from non-parent', async () => {
            const imposter = await blockchain.treasury('imposter');

            const result = await userDeposit.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalWithdraw',
                    target: addressToSlice(imposter.address),
                    amount: toNano('1')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: imposter.address,
                to: userDeposit.address,
                success: false,
            });
        });

        it('should handle multiple withdrawals correctly', async () => {
            const startBalance = await userDeposit.getGetDeposit();
            const withdrawals = [toNano('0.5'), toNano('1'), toNano('0.3')];
            let totalWithdrawn = 0n;

            for (const amount of withdrawals) {
                const result = await feeBank.send(
                    user.getSender(),
                    {
                        value: toNano('0.1'),
                    },
                    {
                        $$type: 'Withdraw',
                        amount: amount
                    }
                );

                expect(result.transactions).toHaveTransaction({
                    from: feeBank.address,
                    to: userDeposit.address,
                    success: true,
                    op: OPCODES.INTERNAL_WITHDRAW,
                });

                totalWithdrawn += amount;
            }

            const finalBalance = await userDeposit.getGetDeposit();
            expect(startBalance - finalBalance).toBeGreaterThanOrEqual(totalWithdrawn);
        });
    });

    describe('Credit Management from Charger', () => {
        it('should handle credit operations from charger', async () => {
            const creditAmount = toNano('3');

            // Simulate charger increasing credit
            const result = await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalIncreaseCredit',
                    amount: creditAmount
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: charger.address,
                to: userDeposit.address,
                success: true,
            });

            // Should respond to charger
            expect(result.transactions).toHaveTransaction({
                from: userDeposit.address,
                to: charger.address,
                success: true,
                op: OPCODES.INTERNAL_CREDIT_INCREASED,
            });

            expect(await userDeposit.getGetCreditAllowance()).toBe(creditAmount);
        });

        it('should charge fees from credit', async () => {
            // First, give some credit
            await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalIncreaseCredit',
                    amount: toNano('5')
                }
            );

            // Then charge fee
            const feeAmount = toNano('1');
            const result = await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalChargeFee',
                    fee: feeAmount
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: charger.address,
                to: userDeposit.address,
                success: true,
            });

            expect(await userDeposit.getGetCreditAllowance()).toBe(toNano('4'));
        });

        it('should reject credit operations from non-charger', async () => {
            const imposter = await blockchain.treasury('imposter');

            // Try to increase credit
            const result1 = await userDeposit.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalIncreaseCredit',
                    amount: toNano('5')
                }
            );

            expect(result1.transactions).toHaveTransaction({
                from: imposter.address,
                to: userDeposit.address,
                success: false,
            });

            // Try to charge fee
            const result2 = await userDeposit.send(
                imposter.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalChargeFee',
                    fee: toNano('1')
                }
            );

            expect(result2.transactions).toHaveTransaction({
                from: imposter.address,
                to: userDeposit.address,
                success: false,
            });
        });

        it('should reject decreasing credit below zero', async () => {
            // Try to decrease credit when none exists
            const result = await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalDecreaseCredit',
                    amount: toNano('1')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: charger.address,
                to: userDeposit.address,
                success: false,
            });
        });

        it('should reject charging fee exceeding credit', async () => {
            // Give small credit
            await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalIncreaseCredit',
                    amount: toNano('1')
                }
            );

            // Try to charge more than available
            const result = await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalChargeFee',
                    fee: toNano('2')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: charger.address,
                to: userDeposit.address,
                success: false,
            });
        });

        it('should handle credit query with custom respondTo', async () => {
            const customResponder = await blockchain.treasury('customResponder');

            // Set some credit first
            await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalIncreaseCredit',
                    amount: toNano('3')
                }
            );

            // Query with custom respondTo
            const result = await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalCreditQuery',
                    respondTo: customResponder.address
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: charger.address,
                to: userDeposit.address,
                success: true,
            });

            // Should respond to custom address
            expect(result.transactions).toHaveTransaction({
                from: userDeposit.address,
                to: customResponder.address,
                success: true,
                op: OPCODES.INTERNAL_CREDIT_RESPONSE,
            });
        });
    });

    describe('Fee Collection through FeeBank', () => {
        it('should calculate fees when requested by FeeBank', async () => {
            const currentDeposit = await userDeposit.getGetDeposit();
            const newCredit = toNano('3'); // Less than deposit, so fee should be collected

            const result = await userDeposit.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'InternalGatherFee',
                    creditNew: newCredit
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                success: true,
            });

            // Should report fee to FeeBank
            expect(result.transactions).toHaveTransaction({
                from: userDeposit.address,
                to: feeBank.address,
                success: true,
                op: OPCODES.INTERNAL_FEE_COLLECTED,
            });

            // Deposit should be reduced to newCredit
            expect(await userDeposit.getGetDeposit()).toBe(newCredit);
        });

        it('should handle zero fee collection', async () => {
            const currentDeposit = await userDeposit.getGetDeposit();
            const newCredit = currentDeposit + toNano('1'); // More than deposit, no fee

            const result = await userDeposit.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'InternalGatherFee',
                    creditNew: newCredit
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                success: true,
            });

            // Should still report to FeeBank (with 0 fee)
            expect(result.transactions).toHaveTransaction({
                from: userDeposit.address,
                to: feeBank.address,
                success: true,
                op: OPCODES.INTERNAL_FEE_COLLECTED,
            });

            // Deposit should remain unchanged
            expect(await userDeposit.getGetDeposit()).toBe(currentDeposit);
        });

        it('should reject fee gathering from non-parent', async () => {
            const imposter = await blockchain.treasury('imposter');

            const result = await userDeposit.send(
                imposter.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'InternalGatherFee',
                    creditNew: toNano('1')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: imposter.address,
                to: userDeposit.address,
                success: false,
            });
        });

        it('should collect entire deposit as fee when credit is zero', async () => {
            const currentDeposit = await userDeposit.getGetDeposit();

            const result = await userDeposit.send(
                blockchain.sender(feeBank.address),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'InternalGatherFee',
                    creditNew: 0n
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                success: true,
            });

            // Deposit should be 0
            expect(await userDeposit.getGetDeposit()).toBe(0n);
        });
    });

    describe('Integration with FeeBank operations', () => {
        it('should work correctly in full deposit-withdraw cycle', async () => {
            // Initial state: ~5.1 TON deposited
            const initialBalance = await userDeposit.getGetDeposit();
            expect(initialBalance).toBeGreaterThan(toNano('5'));

            // Make another deposit
            const depositAmount = toNano('3');
            await feeBank.send(
                user.getSender(),
                {
                    value: depositAmount + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            const balanceAfterDeposit = await userDeposit.getGetDeposit();
            expect(balanceAfterDeposit).toBeGreaterThan(initialBalance + depositAmount);

            // Withdraw some
            const withdrawAmount = toNano('2');
            const balanceBeforeWithdraw = await userDeposit.getGetDeposit();

            await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Withdraw',
                    amount: withdrawAmount
                }
            );

            // Wait for the transaction to complete
            await new Promise(resolve => setTimeout(resolve, 100));

            const finalBalance = await userDeposit.getGetDeposit();
            // Balance should decrease by withdrawal amount
            expect(balanceBeforeWithdraw - finalBalance).toBeGreaterThanOrEqual(withdrawAmount);
        });
    });

    describe('Edge Cases and Error Scenarios', () => {
        it('should handle deposit-withdraw with credit interaction', async () => {
            // Set credit
            await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalIncreaseCredit',
                    amount: toNano('2')
                }
            );

            // Make deposit
            await feeBank.send(
                user.getSender(),
                {
                    value: toNano('3') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            const deposit = await userDeposit.getGetDeposit();
            const credit = await userDeposit.getGetCreditAllowance();

            // Try to withdraw more than deposit but less than deposit + credit
            const withdrawAmount = deposit + toNano('1');

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

            // Should fail because withdrawal checks deposit only, not credit
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                op: OPCODES.INTERNAL_WITHDRAW,
                success: false,
            });
        });

        it('should maintain consistency after failed operations', async () => {
            const initialDeposit = await userDeposit.getGetDeposit();
            const initialCredit = await userDeposit.getGetCreditAllowance();

            // Try invalid withdrawal
            await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'Withdraw',
                    amount: initialDeposit + toNano('10')
                }
            );

            // Try invalid fee charge
            await userDeposit.send(
                charger.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'InternalChargeFee',
                    fee: initialCredit + toNano('10')
                }
            );

            // State should remain unchanged
            expect(await userDeposit.getGetDeposit()).toBe(initialDeposit);
            expect(await userDeposit.getGetCreditAllowance()).toBe(initialCredit);
        });

        it('should handle withdraw to different address correctly', async () => {
            const recipient = await blockchain.treasury('recipient');

            const result = await feeBank.send(
                user.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'WithdrawTo',
                    account: addressToSlice(recipient.address),
                    amount: toNano('1')
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: feeBank.address,
                success: true,
            });

            // UserDeposit should process withdrawal
            expect(result.transactions).toHaveTransaction({
                from: feeBank.address,
                to: userDeposit.address,
                success: true,
                op: OPCODES.INTERNAL_WITHDRAW,
            });
        });

        it('should properly track fee collection', async () => {
            // Give large deposit
            await feeBank.send(
                user.getSender(),
                {
                    value: toNano('10') + toNano('0.1'),
                },
                {
                    $$type: 'Deposit'
                }
            );

            const deposit = await userDeposit.getGetDeposit();

            // Collect fees multiple times
            const feeAmounts = [toNano('2'), toNano('3'), toNano('1')];
            let remainingDeposit = deposit;

            for (const fee of feeAmounts) {
                remainingDeposit = remainingDeposit - fee;

                await userDeposit.send(
                    blockchain.sender(feeBank.address),
                    {
                        value: toNano('0.05'),
                    },
                    {
                        $$type: 'InternalGatherFee',
                        creditNew: remainingDeposit
                    }
                );

                expect(await userDeposit.getGetDeposit()).toBe(remainingDeposit);
            }
        });
    });
});