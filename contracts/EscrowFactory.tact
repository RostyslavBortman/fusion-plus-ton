import "@stdlib/deploy";
import "./EscrowSrc.tact";
import "./EscrowDst.tact";
import "./MerkleValidator/libs/MerkleProof.tact";
import "./FeeBank/FeeBankMessages.tact";

message CreateEscrowSrc {
    maker: Slice;
    taker: Slice;
    token: Slice;
    amount: Int as uint128;
    safetyDeposit: Int as uint128;
    hashlock: Int as uint256;
    tlSrcWithdraw: Int as uint32;
    tlSrcPubWithdraw: Int as uint32;
    tlSrcCancel: Int as uint32;
    tlSrcPubCancel: Int as uint32;
    tlRescueStart: Int as uint32;
}

message CreateEscrowDst {
    maker: Slice;
    taker: Slice;
    token: Slice;
    amount: Int as uint128;
    safetyDeposit: Int as uint128;
    hashlock: Int as uint256;
    tlDstWithdraw: Int as uint32;
    tlDstPubWithdraw: Int as uint32;
    tlDstCancel: Int as uint32;
    tlRescueStart: Int as uint32;
}

message CreateDstEscrow {
    immutables: Cell;
    cancellation: Int as uint256;
}

struct ValidationData {
    index: Int as uint256;
    secretHash: Int as uint256;
}

struct TakerData {
    proof: Cell;
    idx: Int as uint256;
    secretHash: Int as uint256;
}

struct ExtraDataArgs {
    hashlockInfo: Int as uint256;
    dstChainId: Int as uint256;
    dstToken: Slice;
    deposits: Int as uint256;
    timelocks: Int as uint256;
}

message TakerInteraction {
    order: Cell;
    extension: Cell;
    orderHash: Int as uint256;
    taker: Address;
    makingAmount: Int as uint256;
    takingAmount: Int as uint256;
    remainingMakingAmount: Int as uint256;
    extraData: Cell;
}

message UpdateValidation {
    index: Int as uint256;
    secretHash: Int as uint256;
}

message QueryValidation {
    orderHash: Int as uint256;
    rootShortened: Int as uint240;
    respondTo: Address;
}

message ValidationResponse {
    orderHash: Int as uint256;
    rootShortened: Int as uint240;
    data: ValidationData;
}

struct ValidationStorageInit {
    parent: Address;
    orderHash: Int as uint256;
    rootShortened: Int as uint240;
}

contract EscrowFactory with Deployable {
    limitOrderProtocol: Address;
    feeBank: Address;

    const SRC_IMMUTABLES_LENGTH: Int = 160 * 8;

    init(limitOrderProtocol: Address, feeBank: Address) {
        self.limitOrderProtocol = limitOrderProtocol;
        self.feeBank = feeBank;
    }

    fun getValidationStorageAddress(orderHash: Int, rootShortened: Int): Address {
        let i = ValidationStorageInit { parent: myAddress(), orderHash, rootShortened };
        return contractAddress(initOf ValidationStorage(i));
    }

    fun parseTakerData(cd: Cell): TakerData {
        let s = cd.beginParse();
        return TakerData { proof: s.loadRef(), idx: s.loadUint(256), secretHash: s.loadUint(256) };
    }

    fun parseExtraDataArgs(e: Cell): ExtraDataArgs {
        let s = e.beginParse();
        let h = s.loadUint(256);
        let c = s.loadUint(256);
        let t = s.loadBits(160);
        let r = s.loadRef().beginParse();
        return ExtraDataArgs { hashlockInfo: h, dstChainId: c, dstToken: t, deposits: r.loadUint(256), timelocks: r.loadUint(256) };
    }

    fun _chargeFee(amount: Int) {
        if (amount == 0) {
            return;
        }
        send(SendParameters { to: self.feeBank, value: ton("0.04"), bounce: true, body: InternalDeposit { amount }.toCell() });
    }

    fun _validPartial(making: Int, remain: Int, total: Int, parts: Int, idx: Int): Bool {
        let calc = (total - remain + making - 1) * parts / total;
        if (remain == making) {
            return calc + 2 == idx;
        }
        if (total != remain) {
            let prev = (total - remain - 1) * parts / total;
            if (calc == prev) {
                return false;
            }
        }
        return calc + 1 == idx;
    }

    receive(msg: CreateEscrowSrc) {
        let init  = initOf EscrowSrc(
            msg.maker, msg.taker, msg.token, msg.amount, msg.safetyDeposit,
            msg.hashlock, msg.tlSrcWithdraw, msg.tlSrcPubWithdraw,
            msg.tlSrcCancel,  msg.tlSrcPubCancel, msg.tlRescueStart
        );

        let val = context().value - ton("0.05");
        require(val > 0, "LowBalance");

        send(SendParameters{
            to:    contractAddress(init),
            value: val,
            bounce:false,
            code:  init.code,
            data:  init.data,
            //body:  beginCell().endCell()
        });
    }

    receive(msg: CreateEscrowDst) {
        let init = initOf EscrowDst(
            msg.maker, msg.taker, msg.token, msg.amount, msg.safetyDeposit,
            msg.hashlock, msg.tlDstWithdraw, msg.tlDstPubWithdraw,
            msg.tlDstCancel,  msg.tlRescueStart
        );

        let val = context().value - ton("0.05");
        require(val > 0, "LowBalance");

        send(SendParameters{
            to:    contractAddress(init),
            value: val,
            bounce:false,
            code:  init.code,
            data:  init.data,
            //body:  beginCell().endCell()
        });
    }


    receive(msg: TakerInteraction) {
        require(sender() == self.limitOrderProtocol, "AccessDenied");
        let td = self.parseTakerData(msg.extraData);
        let ex = self.parseExtraDataArgs(msg.extension);
        let root = ex.hashlockInfo & ((1 << 240) - 1);
        let leaf = createLeafHash(td.idx, td.secretHash);
        require(verifyMerkleProof(td.proof, leaf, root), "InvalidProof");
        if ((ex.hashlockInfo >> 240) > 1) {
            let parts = (ex.hashlockInfo >> 240) & ((1 << 16) - 1);
            let tot = msg.order.beginParse().loadUint(256);
            require(self._validPartial(msg.makingAmount, msg.remainingMakingAmount, tot, parts, td.idx), "InvalidPartialFill");
        }
        let vsAddr = self.getValidationStorageAddress(msg.orderHash, root);
        let vsInit = initOf ValidationStorage(ValidationStorageInit { parent: myAddress(), orderHash: msg.orderHash, rootShortened: root });
        send(SendParameters { to: vsAddr, value: ton("0.05"), bounce: false, body: UpdateValidation { index: td.idx, secretHash: td.secretHash }.toCell(), code: vsInit.code, data: vsInit.data });
    }

    receive(msg: QueryValidation) {
        let addr = self.getValidationStorageAddress(msg.orderHash, msg.rootShortened);
        send(SendParameters { to: addr, value: 0, mode: SendRemainingValue, body: msg.toCell() });
    }

    get fun addressOfEscrowSrc(msg: CreateEscrowSrc): Address {
        return contractAddress(initOf EscrowSrc(msg.maker, msg.taker, msg.token, msg.amount, msg.safetyDeposit, msg.hashlock, msg.tlSrcWithdraw, msg.tlSrcPubWithdraw, msg.tlSrcCancel, msg.tlSrcPubCancel, msg.tlRescueStart));
    }

    get fun addressOfEscrowDst(msg: CreateEscrowDst): Address {
        return contractAddress(initOf EscrowDst(msg.maker, msg.taker, msg.token, msg.amount, msg.safetyDeposit, msg.hashlock, msg.tlDstWithdraw, msg.tlDstPubWithdraw, msg.tlDstCancel, msg.tlRescueStart));
    }

    get fun validationStorage(orderHash: Int, rootShortened: Int): Address {
        return self.getValidationStorageAddress(orderHash, rootShortened);
    }
}

contract ValidationStorage {
    parent: Address;
    orderHash: Int as uint256;
    rootShortened: Int as uint240;
    lastIndex: Int as uint256;
    lastSecretHash: Int as uint256;

    init(i: ValidationStorageInit) {
        self.parent = i.parent;
        self.orderHash = i.orderHash;
        self.rootShortened = i.rootShortened;
        self.lastIndex = 0;
        self.lastSecretHash = 0;
    }

    receive(msg: UpdateValidation) {
        require(sender() == self.parent, "OnlyParent");
        require(msg.index > self.lastIndex, "InvalidIndex");
        self.lastIndex = msg.index;
        self.lastSecretHash = msg.secretHash;
        self.reply(ValidationResponse { orderHash: self.orderHash, rootShortened: self.rootShortened, data: ValidationData { index: self.lastIndex, secretHash: self.lastSecretHash } }.toCell());
    }

    receive(msg: QueryValidation) {
        send(SendParameters { to: msg.respondTo, value: 0, mode: SendRemainingValue, body: ValidationResponse { orderHash: self.orderHash, rootShortened: self.rootShortened, data: ValidationData { index: self.lastIndex, secretHash: self.lastSecretHash } }.toCell() });
    }

    get fun lastValidated(): ValidationData {
        return ValidationData { index: self.lastIndex, secretHash: self.lastSecretHash };
    }

    get fun orderHash(): Int {
        return self.orderHash;
    }

    get fun rootShortened(): Int {
        return self.rootShortened;
    }
}
