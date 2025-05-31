import "./lib/BaseEscrowLib.tact";

message(0xb4bb8ed8) WithdrawPriv { secret: Int as uint256; }
message(0x5980d8ce) WithdrawPub  { secret: Int as uint256; }
message(0x8cb44593) CancelPriv   {}
message(0xa6997dbb) Rescue       { token: Slice; amount: Int as uint128; }

contract EscrowDst(
    maker:  Slice,
    taker:  Slice,
    token:  Slice,
    amount: Int as uint128,
    safetyDeposit: Int as uint128,
    hashlock: Int as uint256,
    tlDstWithdraw: Int as uint32,
    tlDstPubWithdraw: Int as uint32,
    tlDstCancel: Int as uint32,
    tlRescueStart: Int as uint32
) {

    receive(msg: WithdrawPriv) {
        require(sender().asSlice() == self.taker, "Sender is not the taker");
        require(now() >= self.tlDstWithdraw, "Current time is less than tlDstWithdraw");
        require(now() <  self.tlDstCancel , "Current time is greater than or equal to tlDstCancel");
        self._withdraw(msg.secret, sender());
    }

    receive(msg: WithdrawPub) {
        require(now() >= self.tlDstPubWithdraw, "Current time is less than tlDstPubWithdraw");
        require(now() <  self.tlDstCancel    , "Current time is greater than or equal to tlDstCancel");
        self._withdraw(msg.secret, sender());
    }

    receive(msg: CancelPriv) {
        require(sender().asSlice() == self.taker, "Sender is not the taker");
        require(now() >= self.tlDstCancel, "Current time is less than tlDstCancel");
        self._cancel();
    }

    receive(msg: Rescue) {
        require(sender().asSlice() == self.taker, "Sender is not the taker");
        require(now() >= self.tlRescueStart, "Current time is less than tlRescueStart");
        sendTokens(msg.token, sender().asSlice(), msg.amount, 0);
    }

    fun _withdraw(secret: Int, caller: Address) {
        require(hashSecret(secret) == self.hashlock, "Hashlock mismatch");
        sendTokens(self.token, self.maker, self.amount, 0);

        message(MessageParameters{
            to: caller,
            value: self.safetyDeposit,
            bounce: false
        });
    }

    inline fun _cancel() {
        sendTokens(self.token, self.taker, self.amount, 0);

        message(MessageParameters{
            to: sender(),
            value: self.safetyDeposit,
            bounce: false
        });
    }
}
