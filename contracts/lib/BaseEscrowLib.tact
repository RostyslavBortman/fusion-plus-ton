import "@stdlib/deploy";


fun sendTokens(token: Slice, to: Slice, amount: Int, qid: Int) {
    if (token.bits() == 0) {
        message(MessageParameters {
            to: to.asAddress(0),
            value: amount,
            bounce: false,
        });
        return;
    }

    let body: Cell = beginCell()
        .storeUint(0x0f8a7ea5, 32)
        .storeUint(qid, 64)
        .storeCoins(amount)
        .storeSlice(to)
        .storeSlice(beginCell().endCell().beginParse())
        .storeSlice(beginCell().endCell().beginParse())
        .endCell();

    message(MessageParameters {
        to: token.asAddress(0),
        value: ton("0.15"),
        bounce: true,
        body,
    });
}

fun hashSecret(secret: Int): Int {
    return keccak256(beginCell().storeUint(secret, 256).endCell().beginParse())
}
