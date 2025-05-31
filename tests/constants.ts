import { beginCell } from '@ton/core';

// Opcodes for internal messages
export const OPCODES = {
    // FeeBank messages
    DEPOSIT: 0x4a25ce37,
    DEPOSIT_FOR: 0x2666dfa5,
    WITHDRAW: 0xd111285d,
    WITHDRAW_TO: 0x5ccc41b3,
    GATHER_FEES: 0x1d591c7b,
    RESCUE_FUNDS: 0xd8d5619d,

    // Credit management
    INCREASE_CREDIT: 0xb895f65f,
    DECREASE_CREDIT: 0x260ef7da,
    AVAIL_CREDIT_QUERY: 0x15047436,
    AVAIL_CREDIT_RESP: 0x5ee2eed5,

    // Internal messages
    INTERNAL_DEPOSIT: 0x3f4d39a6,
    INTERNAL_WITHDRAW: 0x8e2c7b15,
    INTERNAL_GATHER_FEE: 0x9a4f2d81,
    INTERNAL_FEE_COLLECTED: 0x7c5e9f3a,
    INTERNAL_DEPOSIT_SUCCESS: 0xb2d4e837,
    INTERNAL_WITHDRAW_SUCCESS: 0xb2d4e837,

    // Charger messages
    INTERNAL_INCREASE_CREDIT: 0xa3f7d218,
    INTERNAL_DECREASE_CREDIT: 0xc5e9b3f2,
    INTERNAL_CREDIT_QUERY: 0x7d4a8c91,
    INTERNAL_CREDIT_RESPONSE: 0x8f3b2e5a,
    INTERNAL_CHARGE_FEE: 0x2e7c9f4d,
    INTERNAL_CREDIT_INCREASED: 0x9a5d3c7f,
    INTERNAL_CREDIT_DECREASED: 0x4b8e2a91,
    INTERNAL_FEE_CHARGED: 0x6f1e8b3c,
};

// Helper to get empty slice (for native TON)
export const getEmptySlice = () => beginCell().endCell().asSlice();