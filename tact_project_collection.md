# Tact Project Files Collection

Total files found: 4

================================================================================

## File 1: FeeBank.tact
**Path:** FeeBank.tact

```tact
import "@stdlib/deploy";
import "./UserDeposit.tact";
import "./FeeBankMessages.tact";

// ==================== Helper functions ====================

// Send tokens (native TON or Jettons)
fun sendTokens(token: Slice, to: Slice, amount: Int, queryId: Int) {
    if (token.bits() == 0) {
        // Native TON transfer
        send(SendParameters{to: to.asAddress(0), value: amount, mode: SendPayGasSeparately, body: beginCell().endCell()}
        );
    } else {
        // Jetton transfer
        send(SendParameters{
                to: token.asAddress(0),
                value: ton("0.05"),
                mode: SendPayGasSeparately,
                body: beginCell().storeUint(0x0f8a7ea5,
                    32 // transfer op
                ).storeUint(queryId,
                    64 // query_id
                ).storeCoins(amount // amount
                ).storeAddress(to.asAddress(0 // destination
                    )
                ).storeAddress(myAddress() // response_destination
                ).storeBit(false // no custom_payload
                ).storeCoins(1 // forward_ton_amount
                ).storeBit(false // no forward_payload
                ).endCell()
            }
        );
    }
}

// ==================== FeeBank Main Contract ====================

contract FeeBank {
    feeToken: Slice;
    charger: Slice;
    owner: Slice;
    // For tracking gatherFees operation
    pendingFees: Int as uint256;
    pendingGatherAccounts: map<Int, Address>;
    pendingGatherCount: Int;
    totalFeesCollected: Int as uint256;

    inline fun onlyOwner() {
        require(sender().asSlice() == self.owner, "OnlyOwner");
    }

    inline fun notifyCharger(body: Cell) {
        send(SendParameters{to: self.charger.asAddress(0), value: ton("0.05"), bounce: true, body: body});
    }

    fun queryCredit(account: Slice) {
        self.notifyCharger(AvailCreditQuery{account: account, respondTo: null}.toCell());
    }

    fun userDepositContractInit(account: Slice): StateInit {
        let initData = UserDepositInit{
            parent: myAddress(),
            account: account,
            feeToken: self.feeToken,
            charger: self.charger.asAddress(0)
        };
        return initOf UserDepositContract(initData);
    }

    fun userDepositAddress(account: Slice): Address {
        return contractAddress(self.userDepositContractInit(account));
    }

    init(feeToken: Slice, charger: Slice, owner: Slice){
        self.feeToken = feeToken;
        self.charger = charger;
        self.owner = owner;
        self.pendingFees = 0;
        self.pendingGatherAccounts = emptyMap();
        self.pendingGatherCount = 0;
        self.totalFeesCollected = 0;
    }

    // Query available credit for account
    receive(msg: AvailCreditQueryRequest){
        // Forward to charger with sender info
        self.notifyCharger(AvailCreditQuery{account: msg.account, respondTo: sender()}.toCell());
    }

    // Handle native TON deposits
    receive(msg: Deposit){
        require(self.feeToken.bits() == 0, "UseJettonTransfer");
        let amt: Int = context().value;
        self._initiateDeposit(sender().asSlice(), amt);
    }

    receive(msg: DepositFor){
        require(self.feeToken.bits() == 0, "UseJettonTransfer");
        let amt: Int = context().value;
        self._initiateDeposit(msg.account, amt);
    }

    // Handle Jetton deposits
    receive(msg: JettonTransfer){
        require(self.feeToken.bits() > 0, "UseNativeDeposit");
        // Verify sender is the jetton wallet
        require(sender().asSlice() == self.feeToken, "InvalidJettonWallet");
        // Use response_destination as the depositor
        self._initiateDeposit(msg.response_destination.asSlice(), msg.amount);
    }

    receive(msg: Withdraw){
        self._initiateWithdraw(sender().asSlice(), sender().asSlice(), msg.amount);
    }

    receive(msg: WithdrawTo){
        self._initiateWithdraw(sender().asSlice(), msg.account, msg.amount);
    }

    receive(msg: GatherFees){
        self.onlyOwner();
        // Reset gathering state
        self.pendingGatherAccounts = emptyMap();
        self.pendingGatherCount = 0;
        self.pendingFees = 0;
        // Parse accounts from Cell and store in map
        let cs = msg.accounts.beginParse();
        while (cs.refs() > 0) {
            let accCell = cs.loadRef();
            let accSlice = accCell.asSlice();
            // Load address from slice
            let accAddress = accSlice.loadAddress();
            let accAddressSlice = beginCell().storeAddress(accAddress).endCell().asSlice();
            // Store account address with its hash as key
            self.pendingGatherAccounts.set(accAddressSlice.hash(), accAddress);
            self.pendingGatherCount = self.pendingGatherCount + 1;
            // Query credit for this account
            self.queryCredit(accAddressSlice);
        }
    }

    receive(msg: AvailCreditResp){
        // This should come from charger
        require(sender().asSlice() == self.charger, "OnlyCharger");
        // Find the account in pending list
        let accountHash = msg.account.hash();
        let accountOpt = self.pendingGatherAccounts.get(accountHash);
        if (accountOpt != null) {
            // Send to user deposit contract to update
            let userDepositAddr = self.userDepositAddress(msg.account);
            send(SendParameters{
                    to: userDepositAddr,
                    value: ton("0.03"),
                    bounce: true,
                    body: InternalGatherFee{creditNew: msg.credit}.toCell()
                }
            );
        }
    }

    receive(msg: InternalFeeCollected){
        // Verify sender is a valid user deposit contract
        let expectedAddr = self.userDepositAddress(msg.account);
        require(sender() == expectedAddr, "InvalidUserContract");
        // Accumulate fees
        self.pendingFees = self.pendingFees + msg.fee;
        // Remove processed account and decrement counter
        let accountHash = msg.account.hash();
        if (self.pendingGatherAccounts.get(accountHash) != null) {
            self.pendingGatherAccounts.del(accountHash);
            self.pendingGatherCount = self.pendingGatherCount - 1;
        }

        // Check if we've processed all accounts
        if (self.pendingGatherCount == 0 && self.pendingFees > 0) {
            // All accounts processed, send collected fees to owner
            self.totalFeesCollected = self.totalFeesCollected + self.pendingFees;
            sendTokens(self.feeToken, self.owner, self.pendingFees, now());
            self.pendingFees = 0;
        }
    }

    receive(msg: InternalDepositSuccess){
        // Verify sender and notify charger
        let expectedAddr = self.userDepositAddress(msg.account);
        require(sender() == expectedAddr, "InvalidUserContract");
        self.notifyCharger(IncreaseCredit{account: msg.account, amount: msg.amount}.toCell());
    }

    receive(msg: InternalWithdrawSuccess){
        // Verify sender and send tokens
        let expectedAddr = self.userDepositAddress(msg.caller);
        require(sender() == expectedAddr, "InvalidUserContract");
        sendTokens(self.feeToken, msg.target, msg.amount, 0);
    }

    // Handle responses from charger
    receive(msg: IncreaseResp){
        require(sender().asSlice() == self.charger, "OnlyCharger");
        // Credit increase confirmed, nothing else to do
    }

    receive(msg: DecreaseResp){
        require(sender().asSlice() == self.charger, "OnlyCharger");
        // Credit decrease confirmed, withdrawal already processed
    }

    receive(msg: RescueFunds){
        self.onlyOwner();
        sendTokens(msg.token, self.owner, msg.amount, 0);
    }

    fun _initiateDeposit(account: Slice, amount: Int) {
        require(amount > 0, "ZeroAmount");
        // Get init for user deposit contract
        let stateInit = self.userDepositContractInit(account);
        let userDepositAddr = contractAddress(stateInit);
        // Send deposit message to user contract
        send(SendParameters{
                to: userDepositAddr,
                value: ton("0.05"),
                bounce: false,
                body: InternalDeposit{amount: amount}.toCell(),
                code: stateInit.code,
                data: stateInit.data
            }
        );
    }

    fun _initiateWithdraw(caller: Slice, target: Slice, amount: Int) {
        // First notify charger about decrease
        self.notifyCharger(DecreaseCredit{account: caller, amount: amount}.toCell());
        // Send withdraw request to user contract
        let userDepositAddr = self.userDepositAddress(caller);
        send(SendParameters{
                to: userDepositAddr,
                value: ton("0.03"),
                bounce: true,
                body: InternalWithdraw{target: target, amount: amount}.toCell()
            }
        );
    }

    // Getters

    get fun uerDeposit(account: Slice): Address {
        return self.userDepositAddress(account);
    }

    get fun totalFeesCollected(): Int {
        return self.totalFeesCollected;
    }

    get fun pendingGatherCount(): Int {
        return self.pendingGatherCount;
    }
}
```

================================================================================

## File 2: FeeBankCharger.tact
**Path:** FeeBankCharger.tact

```tact
import "@stdlib/deploy";
import "./FeeBankMessages.tact";
import "./FeeBank.tact";
import "./UserDeposit.tact";

// ==================== FeeBankCharger Contract ====================

contract FeeBankCharger with Deployable {
    feeBank: Address;
    feeToken: Slice;
    owner: Address;
    init(feeToken: Slice, owner: Address){
        self.feeToken = feeToken;
        self.owner = owner;
        // Deploy FeeBank contract
        let feeBankInit = initOf FeeBank(feeToken, myAddress().asSlice(), owner.asSlice());
        self.feeBank = contractAddress(feeBankInit);
        // Deploy FeeBank with initial funds
        send(SendParameters{
                to: self.feeBank,
                value: ton("0.1"),
                bounce: false,
                body: beginCell().endCell(),
                code: feeBankInit.code,
                data: feeBankInit.data
            }
        );
    }

    // Only FeeBank can call these methods
    inline fun onlyFeeBank() {
        require(sender() == self.feeBank, "OnlyFeeBankAccess");
    }

    // Get user deposit contract address (same logic as FeeBank)

    fun userDepositAddress(account: Slice): Address {
        let initData = UserDepositInit{
            parent: self.feeBank,
            account: account,
            feeToken: self.feeToken,
            charger: myAddress()
        };
        return contractAddress(initOf UserDepositContract(initData));
    }

    // Handle credit increase request from FeeBank

    receive(msg: IncreaseCredit){
        self.onlyFeeBank();
        // Forward to user's deposit contract
        let userAddr = self.userDepositAddress(msg.account);
        send(SendParameters{
                to: userAddr,
                value: ton("0.03"),
                bounce: true,
                body: InternalIncreaseCredit{amount: msg.amount}.toCell()
            }
        );
    }

    // Handle response from user deposit contract
    receive(msg: InternalCreditIncreased){
        let expectedAddr = self.userDepositAddress(msg.account);
        require(sender() == expectedAddr, "InvalidUserContract");
        // Forward response to FeeBank
        send(SendParameters{
                to: self.feeBank,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: IncreaseResp{total: msg.total}.toCell()
            }
        );
    }

    // Handle credit decrease request from FeeBank
    receive(msg: DecreaseCredit){
        self.onlyFeeBank();
        // Forward to user's deposit contract
        let userAddr = self.userDepositAddress(msg.account);
        send(SendParameters{
                to: userAddr,
                value: ton("0.03"),
                bounce: true,
                body: InternalDecreaseCredit{amount: msg.amount}.toCell()
            }
        );
    }

    // Handle response from user deposit contract
    receive(msg: InternalCreditDecreased){
        let expectedAddr = self.userDepositAddress(msg.account);
        require(sender() == expectedAddr, "InvalidUserContract");
        // Forward response to FeeBank
        send(SendParameters{
                to: self.feeBank,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: DecreaseResp{total: msg.total}.toCell()
            }
        );
    }

    // Handle available credit query
    receive(msg: AvailCreditQuery){
        self.onlyFeeBank();
        // Forward to user's deposit contract
        let userAddr = self.userDepositAddress(msg.account);
        send(SendParameters{
                to: userAddr,
                value: ton("0.03"),
                bounce: true,
                body: InternalCreditQuery{respondTo: msg.respondTo}.toCell()
            }
        );
    }

    // Handle response from user deposit contract
    receive(msg: InternalCreditResponse){
        let expectedAddr = self.userDepositAddress(msg.account);
        require(sender() == expectedAddr, "InvalidUserContract");
        // Forward response to requester (or FeeBank)
        send(SendParameters{
                to: self.feeBank,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: AvailCreditResp{credit: msg.credit, account: msg.account}.toCell()
            }
        );
    }

    // Charge fee from specific account (called by inheriting contracts)
    fun _chargeFee(account: Slice, fee: Int) {
        if (fee > 0) {
            let userAddr = self.userDepositAddress(account);
            send(SendParameters{
                    to: userAddr,
                    value: ton("0.03"),
                    bounce: true,
                    body: InternalChargeFee{fee: fee}.toCell()
                }
            );
        }
    }

    // Handle fee charged response

    receive(msg: InternalFeeCharged){
        let expectedAddr = self.userDepositAddress(msg.account);
        require(sender() == expectedAddr, "InvalidUserContract");

        // Fee successfully charged, can emit event or process further
    }

    // Getter for available credit (queries user contract)
    get fun availableCredit(account: Slice): Address {
        // Returns user deposit contract address
        // Actual credit should be queried from that contract
        return self.userDepositAddress(account);
    }

    // Getter for FeeBank address

    get fun feeBank(): Address {
        return self.feeBank;
    }
}
```

================================================================================

## File 3: FeeBankMessages.tact
**Path:** FeeBankMessages.tact

```tact
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
```

================================================================================

## File 4: UserDeposit.tact
**Path:** UserDeposit.tact

```tact
import "@stdlib/deploy";
import "./FeeBankMessages.tact";
// ==================== Init structure ====================

struct UserDepositInit {
    parent: Address;
    account: Slice;
    feeToken: Slice;
    charger: Address;
}

// ==================== UserDepositContract ====================

contract UserDepositContract {
    parent: Address;
    account: Slice;
    feeToken: Slice;
    charger: Address;
    deposit: Int as uint256;
    creditAllowance: Int as uint256; // Available credit for this user

    init(initData: UserDepositInit){
        self.parent = initData.parent;
        self.account = initData.account;
        self.feeToken = initData.feeToken;
        self.charger = initData.charger;
        self.deposit = 0;
        self.creditAllowance = 0;
    }

    // Only parent FeeBank can call
    inline fun requireParent() {
        require(sender() == self.parent, "OnlyParent");
    }

    // Only charger can call

    inline fun requireCharger() {
        require(sender() == self.charger, "OnlyCharger");
    }

    receive(msg: InternalDeposit){
        self.requireParent();
        self.deposit = self.deposit + msg.amount;
        // Notify parent about successful deposit
        send(SendParameters{
                to: self.parent,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalDepositSuccess{account: self.account, amount: msg.amount}.toCell()
            }
        );
    }

    receive(msg: InternalWithdraw){
        self.requireParent();
        require(self.deposit >= msg.amount, "InsufficientBalance");
        self.deposit = self.deposit - msg.amount;
        // Notify parent about successful withdrawal
        send(SendParameters{
                to: self.parent,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalWithdrawSuccess{caller: self.account, target: msg.target, amount: msg.amount}.toCell()
            }
        );
    }

    receive(msg: InternalGatherFee){
        self.requireParent();
        let fee: Int = 0;
        if (msg.creditNew < self.deposit) {
            fee = self.deposit - msg.creditNew;
            self.deposit = msg.creditNew;
        }

        // Send fee info back to parent
        send(SendParameters{
                to: self.parent,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalFeeCollected{account: self.account, fee: fee}.toCell()
            }
        );
    }

    // Handle credit increase from charger
    receive(msg: InternalIncreaseCredit){
        self.requireCharger();
        self.creditAllowance = self.creditAllowance + msg.amount;
        // Respond with new total
        send(SendParameters{
                to: self.charger,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalCreditIncreased{account: self.account, total: self.creditAllowance}.toCell()
            }
        );
    }

    // Handle credit decrease from charger
    receive(msg: InternalDecreaseCredit){
        self.requireCharger();
        require(self.creditAllowance >= msg.amount, "InsufficientCredit");
        self.creditAllowance = self.creditAllowance - msg.amount;
        // Respond with new total
        send(SendParameters{
                to: self.charger,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalCreditDecreased{account: self.account, total: self.creditAllowance}.toCell()
            }
        );
    }

    // Handle credit query from charger
    receive(msg: InternalCreditQuery){
        self.requireCharger();
        let respondTo = msg.respondTo;
        if (respondTo == null) {
            respondTo = self.charger;
        }
        send(SendParameters{
                to: respondTo!!,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalCreditResponse{account: self.account, credit: self.creditAllowance}.toCell()
            }
        );
    }

    // Handle fee charge from charger
    receive(msg: InternalChargeFee){
        self.requireCharger();
        require(self.creditAllowance >= msg.fee, "NotEnoughCredit");
        self.creditAllowance = self.creditAllowance - msg.fee;
        // Notify charger about successful charge
        send(SendParameters{
                to: self.charger,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: InternalFeeCharged{account: self.account, fee: msg.fee, remaining: self.creditAllowance}.toCell()
            }
        );
    }

    // Getters
    get fun getDeposit(): Int {
        return self.deposit;
    }

    get fun getCreditAllowance(): Int {
        return self.creditAllowance;
    }

    get fun getParent(): Address {
        return self.parent;
    }

    get fun getCharger(): Address {
        return self.charger;
    }

    get fun getAccount(): Slice {
        return self.account;
    }
}
```

================================================================================

