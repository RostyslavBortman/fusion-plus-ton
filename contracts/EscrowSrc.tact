import "./lib/BaseEscrowLib.tact";

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

    receive(msg: Slice) {}

    receive(msg: WithdrawPriv) {
        require(sender() == self.taker.asAddress(0), "Sender is not the taker");
        require(now() >= self.tlSrcWithdraw && now() < self.tlSrcCancel, "Invalid time for withdrawal");
        self._withdraw(msg.secret, sender());
    }

    receive(msg: WithdrawUser) {
        require(sender() == self.taker.asAddress(0), "Sender is not the taker");
        require(now() >= self.tlSrcWithdraw && now() < self.tlSrcCancel, "Invalid time for withdrawal");
        self._withdraw(msg.secret, msg.target.asAddress(0));
    }

    receive(msg: WithdrawPub) {
        require(self.hasAccessToken(sender()), "No access-token");
        require(now() >= self.tlSrcPubWithdraw && now() < self.tlSrcCancel, "Invalid time for public withdrawal");
        self._withdraw(msg.secret, self.taker.asAddress(0));
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

    fun _withdraw(secret: Int, caller: Address) {
        require(hashSecret(secret) == self.hashlock, "Hashlock mismatch");

        sendTokens(self.token, self.maker, self.amount, 0);

        send(SendParameters{
            to:    caller,
            value: self.safetyDeposit,
            bounce:false,
            mode:  1,
            body:  beginCell().endCell()
        });
    }

    inline fun _cancel() {
        sendTokens(self.token, self.taker, self.amount, 0);

        send(SendParameters{
            to:    sender(),
            value: self.safetyDeposit,
            bounce:false,
            mode:  1,
            body:  beginCell().endCell()
        });
    }

    fun hasAccessToken(a: Address): Bool {
        return a == self.taker.asAddress(0);
    }
}
