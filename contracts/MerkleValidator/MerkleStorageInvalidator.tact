import "@stdlib/deploy";
import "./libs/MerkleProof.tact";

// ==================== Structures ====================

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

// ==================== Messages ====================

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
// Make sure QueryValidation has the required fields
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

// ==================== Storage Init ====================

struct ValidationStorageInit {
    parent: Address;
    orderHash: Int as uint256;
    rootShortened: Int as uint240;
}

// ==================== Main Contract ====================

contract MerkleStorageInvalidator with Deployable {
    limitOrderProtocol: Address;
    const SRC_IMMUTABLES_LENGTH: Int = 160 * 8;
    init(limitOrderProtocol: Address){
        self.limitOrderProtocol = limitOrderProtocol;
    }

    fun getValidationStorageAddress(orderHash: Int, rootShortened: Int): Address {
        let initData = ValidationStorageInit{parent: myAddress(), orderHash: orderHash, rootShortened: rootShortened};
        return contractAddress(initOf ValidationStorage(initData));
    }

    fun parseTakerData(extraData: Cell): TakerData {
        let slice = extraData.beginParse();
        let proof = slice.loadRef();
        let idx = slice.loadUint(256);
        let secretHash = slice.loadUint(256);
        return TakerData{proof: proof, idx: idx, secretHash: secretHash};
    }

    fun parseExtraDataArgs(extension: Cell): ExtraDataArgs {
        let slice = extension.beginParse();
        let hashlockInfo = slice.loadUint(256);
        let dstChainId = slice.loadUint(256);
        let dstToken = slice.loadBits(160);
        let refSlice = slice.loadRef().beginParse();
        let deposits = refSlice.loadUint(256);
        let timelocks = refSlice.loadUint(256);
        return
            ExtraDataArgs{
                hashlockInfo: hashlockInfo,
                dstChainId: dstChainId,
                dstToken: dstToken,
                deposits: deposits,
                timelocks: timelocks
            };
    }

    receive(msg: TakerInteraction){
        require(sender() == self.limitOrderProtocol, "AccessDenied");
        let takerData = self.parseTakerData(msg.extraData);
        let extraDataArgs = self.parseExtraDataArgs(msg.extension);
        let rootShortened = extraDataArgs.hashlockInfo & ((1 << 240) - 1);
        let leafHash = createLeafHash(takerData.idx, takerData.secretHash);
        let proofValid = verifyMerkleProof(takerData.proof, leafHash, rootShortened);
        require(proofValid, "InvalidProof");
        let storageAddr = self.getValidationStorageAddress(msg.orderHash, rootShortened);
        let storageInit = initOf ValidationStorage(ValidationStorageInit{
                parent: myAddress(),
                orderHash: msg.orderHash,
                rootShortened: rootShortened
            }
        );
        send(SendParameters{
                to: storageAddr,
                value: ton("0.05"),
                bounce: false,
                body: UpdateValidation{index: takerData.idx + 1, secretHash: takerData.secretHash}.toCell(),
                code: storageInit.code,
                data: storageInit.data
            }
        );
    }

    receive(msg: QueryValidation){
        // Now msg has orderHash and rootShortened fields
        let storageAddr = self.getValidationStorageAddress(msg.orderHash, msg.rootShortened);
        send(SendParameters{to: storageAddr, value: 0, mode: SendRemainingValue, body: msg.toCell()});
    }

    get fun lastValidated(orderHash: Int, rootShortened: Int): Address {
        return self.getValidationStorageAddress(orderHash, rootShortened);
    }
}

// ==================== Storage Contract ====================

contract ValidationStorage {
    parent: Address;
    orderHash: Int as uint256;
    rootShortened: Int as uint240;
    lastIndex: Int as uint256;
    lastSecretHash: Int as uint256;
    init(initData: ValidationStorageInit){
        self.parent = initData.parent;
        self.orderHash = initData.orderHash;
        self.rootShortened = initData.rootShortened;
        self.lastIndex = 0;
        self.lastSecretHash = 0;
    }

    receive(msg: UpdateValidation){
        require(sender() == self.parent, "OnlyParent");
        require(msg.index > self.lastIndex, "InvalidIndex");
        self.lastIndex = msg.index;
        self.lastSecretHash = msg.secretHash;
        self.reply(ValidationResponse{
                orderHash: self.orderHash,
                rootShortened: self.rootShortened,
                data: ValidationData{index: self.lastIndex, secretHash: self.lastSecretHash}
            }.toCell()
        );
    }

    receive(msg: QueryValidation){
        send(SendParameters{
                to: msg.respondTo,
                value: 0,
                mode: SendRemainingValue,
                body: ValidationResponse{
                    orderHash: self.orderHash,
                    rootShortened: self.rootShortened,
                    data: ValidationData{index: self.lastIndex, secretHash: self.lastSecretHash}
                }.toCell()
            }
        );
    }

    get fun lastValidated(): ValidationData {
        return ValidationData{index: self.lastIndex, secretHash: self.lastSecretHash};
    }

    get fun orderHash(): Int {
        return self.orderHash;
    }

    get fun rootShortened(): Int {
        return self.rootShortened;
    }
}