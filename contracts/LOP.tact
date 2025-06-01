import "@stdlib/deploy";
import "./EscrowFactory.tact";

message TriggerInteraction {
    order: Cell;
    extension: Cell;
    orderHash: Int as uint256;
    taker: Address;
    makingAmount: Int as uint256;
    takingAmount: Int as uint256;
    remainingMakingAmount: Int as uint256;
    extraData: Cell;
}

contract LimitOrderProtocol with Deployable {
    factory: Address;

    init(factory: Address) {
        self.factory = factory;
    }

    receive(msg: TriggerInteraction) {
        send(SendParameters{
            to:    self.factory,
            value: ton("0.05"),
            bounce:false,
            body:  TakerInteraction{
                       order: msg.order,
                       extension: msg.extension,
                       orderHash: msg.orderHash,
                       taker: msg.taker,
                       makingAmount: msg.makingAmount,
                       takingAmount: msg.takingAmount,
                       remainingMakingAmount: msg.remainingMakingAmount,
                       extraData: msg.extraData
                   }.toCell()
        });
    }

    get fun factory(): Address { return self.factory; }
}
