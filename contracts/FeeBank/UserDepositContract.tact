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
    creditAllowance: Int as uint256;
    init(initData: UserDepositInit){
        self.parent = initData.parent;
        self.account = initData.account;
        self.feeToken = initData.feeToken;
        self.charger = initData.charger;
        self.deposit = 0;
        self.creditAllowance = 0;
    }

    inline fun requireParent() {
        require(sender() == self.parent, "OnlyParent");
    }

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