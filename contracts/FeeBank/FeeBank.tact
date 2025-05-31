import "@stdlib/deploy";
import "./UserDepositContract.tact";
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

contract FeeBank with Deployable {
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