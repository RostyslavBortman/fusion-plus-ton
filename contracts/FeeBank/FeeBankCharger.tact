import "@stdlib/deploy";
import "./FeeBankMessages.tact";
import "./FeeBank.tact";
import "./UserDepositContract.tact";

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