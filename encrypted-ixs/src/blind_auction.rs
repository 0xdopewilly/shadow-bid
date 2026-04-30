use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    #[derive(Copy, Clone)]
    pub struct AuctionState {
        pub highest_bid: u64,
        pub highest_bidder: [u8; 32],
    }

    #[instruction]
    pub fn init_auction_state() -> Enc<Mxe, AuctionState> {
        let initial_state = AuctionState {
            highest_bid: 0,
            highest_bidder: [0u8; 32],
        };
        Mxe::get().from_arcis(initial_state)
    }

    #[instruction]
    pub fn place_bid(
        bid_ctxt: Enc<Shared, u64>,
        bidder_pubkey_ctxt: Enc<Shared, [u8; 32]>,
        state_ctxt: Enc<Mxe, AuctionState>,
    ) -> Enc<Mxe, AuctionState> {
        let new_bid = bid_ctxt.to_arcis();
        let bidder_pk = bidder_pubkey_ctxt.to_arcis();
        let mut state = state_ctxt.to_arcis();

        if new_bid > state.highest_bid {
            state.highest_bid = new_bid;
            state.highest_bidder = bidder_pk;
        }

        state_ctxt.owner.from_arcis(state)
    }
}
