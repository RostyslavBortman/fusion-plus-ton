import "@stdlib/deploy";

// Escrow status enum
const STATUS_CREATED: Int = 0;
const STATUS_FUNDED: Int = 1;
const STATUS_COMPLETED: Int = 2;
const STATUS_CANCELLED: Int = 3;

// Message for creating an escrow
message CreateEscrow {
    orderHash: Int as uint256;      // Order hash identifier
    hashlock: Int as uint256;        // Secret hash for atomic swap
    maker: Address;                  // Order maker address
    taker: Address;                  // Order taker address
    amount: Int as coins;            // Token amount
    safetyDeposit: Int as coins;     // Safety deposit amount
}

// Message for funding the escrow
message FundEscrow {
    // Empty message, funds are sent with it
}

// Simple escrow contract
contract BaseEscrow {
    // Escrow data
    orderHash: Int as uint256;
    hashlock: Int as uint256;
    maker: Address;
    taker: Address;
    amount: Int as coins;
    safetyDeposit: Int as coins;
    deployedAt: Int as uint32;
    status: Int as uint8;           // Current status of the escrow
    
    // Constructor
    init(
        orderHash: Int,
        hashlock: Int,
        maker: Address,
        taker: Address,
        amount: Int,
        safetyDeposit: Int
    ) {
        self.orderHash = orderHash;
        self.hashlock = hashlock;
        self.maker = maker;
        self.taker = taker;
        self.amount = amount;
        self.safetyDeposit = safetyDeposit;
        self.deployedAt = now();
        self.status = STATUS_CREATED;
    }
    
    // Deploy receiver
    receive() {
        // Accept deployment
    }
    
    // Receive funds from maker
    receive(msg: FundEscrow) {
        // Check that escrow is in created state
        require(self.status == STATUS_CREATED, "Escrow is not in created state");
        
        // Check that sender is the maker
        require(sender() == self.maker, "Only maker can fund the escrow");
        
        // Check that sent amount equals required amount + safety deposit
        let requiredAmount: Int = self.amount + self.safetyDeposit;
        require(context().value == requiredAmount, "Incorrect funding amount");
        
        // Update status
        self.status = STATUS_FUNDED;
        
        // Funds are automatically accepted if no error is thrown
    }
    
    // Getters
    get fun orderHash(): Int {
        return self.orderHash;
    }
    
    get fun hashlock(): Int {
        return self.hashlock;
    }
    
    get fun maker(): Address {
        return self.maker;
    }
    
    get fun taker(): Address {
        return self.taker;
    }
    
    get fun amount(): Int {
        return self.amount;
    }
    
    get fun safetyDeposit(): Int {
        return self.safetyDeposit;
    }
    
    get fun deployedAt(): Int {
        return self.deployedAt;
    }
    
    get fun status(): Int {
        return self.status;
    }
    
    get fun balance(): Int {
        return myBalance();
    }
}