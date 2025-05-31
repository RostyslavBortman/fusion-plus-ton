import "./lib/BaseEscrowLib.tact";

message(0xb4bb8ed8) WithdrawPriv {
    secret: Int as uint256;
}
message(0xeb18b56a) WithdrawTo {
    secret: Int as uint256;
    target: Slice;
}
message(0x5980d8ce) WithdrawPub {
    secret: Int as uint256;
}
message(0x8cb44593) CancelPriv {}
message(0x5d2a586e) CancelPub {}
message(0xa6997dbb) Rescue {
    token: Slice;
    amount: Int as uint128;
}

contract EscrowSrc(
    maker: Slice,
    taker: Slice,
    token: Slice,
    amount: Int as uint128,
    safetyDeposit: Int as uint128,
    hashlock: Int as uint256,
    tlSrcWithdraw: Int as uint32,
    tlSrcPubWithdraw: Int as uint32,
    tlSrcCancel: Int as uint32,
    tlSrcPubCancel: Int as uint32,
    tlRescueStart: Int as uint32,
) {

    receive(msg: WithdrawPriv) {
        require(sender() == self.taker.asAddress(0), "Sender is not the taker");
        require(now() >= self.tlSrcWithdraw && now() < self.tlSrcCancel, "Invalid time for withdrawal");
        self._withdraw(msg.secret, sender().asSlice());
    }

    receive(msg: WithdrawTo) {
        require(sender() == self.taker.asAddress(0), "Sender is not the taker");
        require(now() >= self.tlSrcWithdraw && now() < self.tlSrcCancel, "Invalid time for withdrawal");
        self._withdraw(msg.secret, msg.target);
    }

    receive(msg: WithdrawPub) {
        require(self.hasAccessToken(sender()), "No access-token");
        require(now() >= self.tlSrcPubWithdraw && now() < self.tlSrcCancel, "Invalid time for public withdrawal");
        self._withdraw(msg.secret, self.taker);
    }

    receive(msg: CancelPriv) {
        require(sender() == self.taker.asAddress(0) && now() >= self.tlSrcCancel, "Invalid sender or time for cancellation");
        self._cancel();
    }

    receive(msg: CancelPub) {
        require(self.hasAccessToken(sender()), "No access-token");
        require(now() >= self.tlSrcPubCancel, "Invalid time for public cancellation");
        self._cancel();
    }

    receive(msg: Rescue) {
        require(sender() == self.taker.asAddress(0), "Sender is not the taker for rescue");
        require(now() >= self.tlRescueStart, "Rescue operation not allowed yet");
        sendTokens(msg.token, sender().asSlice(), msg.amount, 0);
    }

    fun _withdraw(secret: Int, target: Slice) {
        require(hashSecret(secret) == self.hashlock, "Hashlock mismatch");
        sendTokens(self.token, target, self.amount, 0);

        message(MessageParameters {
            to: sender(),
            value: self.safetyDeposit,
            bounce: false,
        });
    }

    fun _cancel() {
        sendTokens(self.token, self.maker, self.amount, 0);

        message(MessageParameters {
            to: sender(),
            value: self.safetyDeposit,
            bounce: false,
        });
    }

    fun hasAccessToken(a: Address): Bool {
        return a == self.taker.asAddress(0);
    }
}
