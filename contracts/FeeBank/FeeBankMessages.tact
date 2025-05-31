// Request to query available credit
message(0xa7c9f823) AvailCreditQueryRequest {
    account: Slice;
} // ==================== Shared Messages for FeeBank System ====================
// Messages between FeeBank and Charger
message(0xb895f65f) IncreaseCredit {
    account: Slice;
    amount: Int as uint256;
}
message(0x260ef7da) DecreaseCredit {
    account: Slice;
    amount: Int as uint256;
}
message(0x15047436) AvailCreditQuery {
    account: Slice;
    respondTo: Address?; // Optional direct response address
}
message(0x5ee2eed5) AvailCreditResp {
    credit: Int as uint256;
    account: Slice; // Important for tracking responses
}
message(0x2a9b66f1) IncreaseResp {
    total: Int as uint256;
}
message(0xe01e39a5) DecreaseResp {
    total: Int as uint256;
}
// User messages to FeeBank
message(0x4a25ce37) Deposit {
}
message(0x2666dfa5) DepositFor {
    account: Slice;
}
message(0xd111285d) Withdraw {
    amount: Int as uint256;
}
message(0x5ccc41b3) WithdrawTo {
    account: Slice;
    amount: Int as uint256;
}
message(0x1d591c7b) GatherFees {
    accounts: Cell; // Cell containing list of accounts
}
message(0xd8d5619d) RescueFunds {
    token: Slice;
    amount: Int as uint256;
}
// Jetton Transfer message structure
message(0x0f8a7ea5) JettonTransfer {
    query_id: Int as uint64;
    amount: Int as coins;
    destination: Address;
    response_destination: Address;
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}
// Internal messages between FeeBank and UserDepositContract
message(0x3f4d39a6) InternalDeposit {
    amount: Int as uint256;
}
message(0x8e2c7b15) InternalWithdraw {
    target: Slice;
    amount: Int as uint256;
}
message(0x9a4f2d81) InternalGatherFee {
    creditNew: Int as uint256;
}
message(0x7c5e9f3a) InternalFeeCollected {
    account: Slice;
    fee: Int as uint256;
}
message(0xb2d4e837) InternalWithdrawSuccess {
    caller: Slice;
    target: Slice;
    amount: Int as uint256;
}
message(0x4e7f9c12) InternalDepositSuccess {
    account: Slice;
    amount: Int as uint256;
}
// Internal messages between Charger and UserDepositContract
message(0xa3f7d218) InternalIncreaseCredit {
    amount: Int as uint256;
}
message(0xc5e9b3f2) InternalDecreaseCredit {
    amount: Int as uint256;
}
message(0x7d4a8c91) InternalCreditQuery {
    respondTo: Address?;
}
message(0x8f3b2e5a) InternalCreditResponse {
    account: Slice;
    credit: Int as uint256;
}
message(0x2e7c9f4d) InternalChargeFee {
    fee: Int as uint256;
}
message(0x9a5d3c7f) InternalCreditIncreased {
    account: Slice;
    total: Int as uint256;
}
message(0x4b8e2a91) InternalCreditDecreased {
    account: Slice;
    total: Int as uint256;
}
message(0x6f1e8b3c) InternalFeeCharged {
    account: Slice;
    fee: Int as uint256;
    remaining: Int as uint256;
}