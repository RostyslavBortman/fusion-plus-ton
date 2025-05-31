import "@stdlib/deploy";
import "./lib/BaseEscrowLib.tact";

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
}
message(0x5ee2eed5) AvailCreditResp {
    credit: Int as uint256;
}
message(0x2a9b66f1) IncreaseResp {
    total: Int as uint256;
}
message(0xe01e39a5) DecreaseResp {
    total: Int as uint256;
}
message(0x4a25ce37) Deposit {}
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
    accounts: Cell;
}
message(0xd8d5619d) RescueFunds {
    token: Slice;
    amount: Int as uint256;
}

fun parseJettonAmount(cs: Slice): Int {
    let opcode = cs.loadUint(32);
    require(opcode == 0x0f8a7ea5, "NotJettonTransfer");
    let _ = cs.loadUint(64);
    return cs.loadCoins();
}

contract FeeBank {
    feeToken: Slice;
    charger: Slice;
    owner: Slice;
    deposits: map<Int, Int>;

    inline fun onlyOwner() {
        require(sender().asSlice() == self.owner, "OnlyOwner");
    }

    inline fun notifyCharger(body: Cell) {
        message(MessageParameters {
            to: self.charger.asAddress(0),
            value: ton("0.05"),
            bounce: true,
            body,
        });
    }

    inline fun queryCredit(account: Slice) {
        self.notifyCharger(
            beginCell()
                .storeUint(0x15047436, 32)
                .storeSlice(account)
                .endCell(),
        );
    }

    init(feeToken: Slice, charger: Slice, owner: Slice) {
        self.feeToken = feeToken;
        self.charger = charger;
        self.owner = owner;
        self.deposits = emptyMap();
    }

    receive(msg: Deposit) {
        let amt: Int = (self.feeToken.bits() == 0) ? context().value : parseJettonAmount(inMsg());
        self._deposit(sender().asSlice(), amt);
    }

    receive(msg: DepositFor) {
        let amt: Int = (self.feeToken.bits() == 0) ? context().value : parseJettonAmount(inMsg());
        self._deposit(msg.account, amt);
    }

    receive(msg: Withdraw) {
        self._withdraw(sender().asSlice(), sender().asSlice(), msg.amount);
    }

    receive(msg: WithdrawTo) {
        self._withdraw(sender().asSlice(), msg.account, msg.amount);
    }

    receive(msg: GatherFees) {
        self.onlyOwner();

        let cs = msg.accounts.beginParse();
        while (cs.bits() > 0) {
            let accCell = cs.loadRef();
            let accSlice = accCell.asSlice();
            self.queryCredit(accSlice);
        }
    }

    receive(msg: AvailCreditResp) {
        let body = inMsg();
        let cs = body;
        let _ = cs.loadUint(32);
        let creditNew = cs.loadUint(256);

        if (cs.bits() > 0) {
            let accCell = cs.loadRef();
            let accSlice = accCell.asSlice();
            let key = accSlice.hash();

            let beforeOpt = self.deposits.get(key);
            let before = beforeOpt == null ? 0 : beforeOpt!!;

            if (creditNew < before) {
                let fee = before - creditNew;
                self.deposits.set(key, creditNew);
                sendTokens(self.feeToken, self.owner, fee, 0);
            } else {
                self.deposits.set(key, creditNew);
            }
        }
    }

    receive(msg: RescueFunds) {
        self.onlyOwner();
        sendTokens(msg.token, self.owner, msg.amount, 0);
    }

    fun _deposit(account: Slice, amount: Int) {
        require(amount > 0, "ZeroAmount");

        let key = account.hash();
        let prev = self.deposits.exists(key) ? self.deposits.get(key)!! : 0;
        self.deposits.set(key, prev + amount);

        self.notifyCharger(
            beginCell()
                .storeUint(0xb895f65f, 32)
                .storeSlice(account)
                .storeUint(amount, 256)
                .endCell(),
        );
    }

    fun _withdraw(caller: Slice, target: Slice, amount: Int) {
        self.notifyCharger(
            beginCell()
                .storeUint(0x260ef7da, 32)
                .storeSlice(caller)
                .storeUint(amount, 256)
                .endCell(),
        );

        let key = caller.hash();
        let prev = self.deposits.get(key);
        self.deposits.set(key, prev!! - amount);

        sendTokens(self.feeToken, target, amount, 0);
    }
}
