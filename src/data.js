// Original, offline training positions. Moves are UCI; replies are included.
export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const puzzles = [
  {
    id: "back-rank",
    title: "The back rank",
    theme: "Back-rank mate",
    rating: 400,
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    moves: ["a1a8"],
    explanation:
      "Ra8 is checkmate. The king’s own pawns block its escape squares.",
  },
  {
    id: "open-file",
    title: "An open invitation",
    theme: "Back-rank mate",
    rating: 450,
    fen: "1k6/ppp5/8/8/8/8/8/1K5R w - - 0 1",
    moves: ["h1h8"],
    explanation:
      "Rh8 uses the open file and seals the eighth rank. The pawns trap their own king.",
  },
  {
    id: "queen-net",
    title: "Close the net",
    theme: "Queen and king",
    rating: 500,
    fen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
    moves: ["g6g7"],
    explanation:
      "Qg7 is protected by the king on f6. The queen covers every flight square.",
  },
  {
    id: "cornered",
    title: "Nowhere to go",
    theme: "Queen and king",
    rating: 500,
    fen: "k7/8/1QK5/8/8/8/8/8 w - - 0 1",
    moves: ["b6b7"],
    explanation:
      "Qb7 completes the mating net. Always make sure your queen is protected.",
  },
  {
    id: "fools-mate",
    title: "A dangerous diagonal",
    theme: "Opening tactics",
    rating: 550,
    fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",
    moves: ["d8h4"],
    explanation:
      "Qh4 is mate. Advancing the f- and g-pawns left the king’s diagonal undefended.",
  },
  {
    id: "scholars-mate",
    title: "The weakest square",
    theme: "Double attack",
    rating: 600,
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    moves: ["h5f7"],
    explanation:
      "Qxf7 is checkmate: the bishop on c4 protects the queen and f7 has only the king as a defender.",
  },
  {
    id: "smothered",
    title: "A knight to remember",
    theme: "Smothered mate",
    rating: 750,
    fen: "6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1",
    moves: ["h6f7"],
    explanation:
      "Nf7 is smothered mate. The rook and pawns leave the black king no room.",
  },
  {
    id: "smothered-left",
    title: "Trapped in the corner",
    theme: "Smothered mate",
    rating: 750,
    fen: "kr6/pp6/N7/8/8/8/8/6K1 w - - 0 1",
    moves: ["a6c7"],
    explanation:
      "Nc7 is mate. A knight’s check cannot be blocked, and the king is surrounded.",
  },
  {
    id: "ladder",
    title: "One rung at a time",
    theme: "Ladder mate",
    rating: 650,
    fen: "7k/1R6/R7/8/8/8/8/6K1 w - - 0 1",
    moves: ["a6a8"],
    explanation:
      "Ra8 is mate. The rook on b7 cuts off the seventh rank while the other rook delivers check.",
  },
  {
    id: "promotion",
    title: "A new queen",
    theme: "Promotion",
    rating: 700,
    fen: "k7/2P4R/1K6/8/8/8/8/8 w - - 0 1",
    moves: ["c7c8q"],
    explanation:
      "Promote to a queen with checkmate. The rook and king cover the remaining escape squares.",
  },
  {
    id: "rook-knight",
    title: "A perfect partnership",
    theme: "Rook and knight mate",
    rating: 850,
    fen: "7k/6pp/5N2/8/8/8/8/6KR w - - 0 1",
    moves: ["h1h7"],
    explanation:
      "Rxh7 is mate. The knight protects h7 and controls g8, while the g7 pawn blocks the king.",
  },
  {
    id: "loose-queen",
    title: "Loose pieces fall",
    theme: "Hanging piece",
    rating: 400,
    fen: "7k/5q2/8/8/2B5/8/8/6K1 w - - 0 1",
    moves: ["c4f7"],
    explanation:
      "Bxf7 wins the undefended queen. Check every capture before making a quiet move.",
  },
  {
    id: "royal-fork",
    title: "A royal fork",
    theme: "Knight fork",
    rating: 900,
    fen: "2q1k3/1r6/8/5N2/8/8/8/6K1 w - - 0 1",
    moves: ["f5d6", "e8f8", "d6c8"],
    explanation:
      "Nd6 checks the king and attacks the queen on c8. After the king moves, Nxc8 wins the queen.",
  },
  {
    id: "skewer",
    title: "Look behind the king",
    theme: "Skewer",
    rating: 950,
    fen: "4q3/3k4/8/8/2B5/8/8/6K1 w - - 0 1",
    moves: ["c4b5", "d7c7", "b5e8"],
    explanation:
      "Bb5 checks along the diagonal. When the king steps away, Bxe8 captures the queen behind it.",
  },
  {
    id: "queen-eighth",
    title: "Across the eighth rank",
    theme: "Back-rank mate",
    rating: 500,
    fen: "k7/pp6/8/1Q6/8/8/8/6K1 w - - 0 1",
    moves: ["b5e8"],
    explanation:
      "Qe8 is checkmate. The queen controls the eighth rank and the king’s own pawns block its escape.",
  },
  {
    id: "black-back-rank",
    title: "Turn the tables",
    theme: "Back-rank mate",
    rating: 500,
    fen: "r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1",
    moves: ["a8a1"],
    explanation:
      "Ra1 is checkmate. The same back-rank pattern works for Black.",
  },
  {
    id: "black-smothered",
    title: "No escape squares",
    theme: "Smothered mate",
    rating: 750,
    fen: "6k1/8/8/8/8/7n/6PP/6RK b - - 0 1",
    moves: ["h3f2"],
    explanation:
      "Nf2 is checkmate. White’s own rook and pawns trap the king, and a knight’s check cannot be blocked.",
  },
  {
    id: "black-promotion",
    title: "The last step",
    theme: "Promotion",
    rating: 700,
    fen: "8/8/8/8/8/1k6/2p4r/K7 b - - 0 1",
    moves: ["c2c1q"],
    explanation:
      "Promoting to a queen gives checkmate. The rook covers the second rank and the king supports the mating net.",
  },
  {
    id: "bishop-rook",
    title: "Follow the diagonal",
    theme: "Hanging piece",
    rating: 450,
    fen: "r6k/8/8/3B4/8/8/8/6K1 w - - 0 1",
    moves: ["d5a8"],
    explanation:
      "Bxa8 wins the undefended rook. Scan long diagonals before choosing your move.",
  },
  {
    id: "black-queen-capture",
    title: "A bishop’s opportunity",
    theme: "Hanging piece",
    rating: 450,
    fen: "6k1/8/8/2b5/8/8/5Q2/7K b - - 0 1",
    moves: ["c5f2"],
    explanation:
      "Bxf2 wins the unprotected queen. Black can use the same tactical ideas as White.",
  },
];

export const lessons = [
  {
    id: "center",
    title: "Control the Center",
    subtitle: "Your first moves matter",
    icon: "♟",
    level: "New to Chess",
    description:
      "The center is the crossroads of the board. Claim space with your pawns, then develop your pieces toward it.",
    fen: START_FEN,
    moves: ["e2e4", "e7e5", "d2d4"],
    steps: [
      "Move the e-pawn two squares to e4. It controls d5 and f5 and opens lines for your bishop and queen.",
      "Black claims space with e5.",
      "Play d4 to challenge Black’s center. Your pawns now influence the most important squares.",
    ],
  },
  {
    id: "development",
    title: "Bring Your Pieces to Life",
    subtitle: "Knights before adventures",
    icon: "♞",
    level: "New to Chess",
    description:
      "Develop your knights and bishops so they can join the game. Avoid moving the same piece repeatedly in the opening.",
    fen: START_FEN,
    moves: ["g1f3", "g8f6", "b1c3"],
    steps: [
      "Develop the king’s knight to f3. From here it watches the center.",
      "Black develops a knight too.",
      "Develop the other knight to c3. Both knights are active and ready to help.",
    ],
  },
  {
    id: "castling",
    title: "Get Your King to Safety",
    subtitle: "Two pieces, one move",
    icon: "♔",
    level: "Beginner",
    description:
      "Castling shelters your king and connects your rooks. The king and rook must not have moved, and the king cannot castle through check.",
    fen: "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    moves: ["e1g1"],
    steps: [
      "Castle kingside by moving your king from e1 to g1. The rook automatically moves from h1 to f1.",
    ],
  },
  {
    id: "forks",
    title: "The Power of a Fork",
    subtitle: "One move, two threats",
    icon: "♘",
    level: "Beginner",
    description:
      "A fork attacks two valuable targets at once. A check is especially useful because your opponent must answer it.",
    fen: "2q1k3/1r6/8/5N2/8/8/8/6K1 w - - 0 1",
    moves: ["f5d6", "e8f8", "d6c8"],
    steps: [
      "Play Nd6+. Your knight attacks the king and the queen.",
      "The black king moves away from check.",
      "Capture the queen on c8. The fork has won decisive material.",
    ],
  },
  {
    id: "backrank",
    title: "Watch the Back Rank",
    subtitle: "Give your king some air",
    icon: "♜",
    level: "Beginner",
    description:
      "A king trapped behind its own pawns is vulnerable to a rook or queen on its back rank.",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    moves: ["a1a8"],
    steps: [
      "Move the rook to a8 for checkmate. Black cannot block, capture, or escape the check.",
    ],
  },
  {
    id: "promotion",
    title: "A Pawn’s Big Moment",
    subtitle: "Reach the last rank",
    icon: "♕",
    level: "Beginner",
    description:
      "A pawn that reaches the final rank becomes a queen, rook, bishop, or knight. Most of the time, a queen is your strongest choice.",
    fen: "k7/2P4R/1K6/8/8/8/8/8 w - - 0 1",
    moves: ["c7c8q"],
    steps: [
      "Push c7 to c8 and choose a queen. In this position, promotion also delivers checkmate.",
    ],
  },
  {
    id: "en-passant",
    title: "The En Passant Capture",
    subtitle: "A special pawn rule",
    icon: "♙",
    level: "Intermediate",
    description:
      "Immediately after an adjacent enemy pawn advances two squares, your pawn may capture it as though it had advanced only one.",
    fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
    moves: ["e5d6"],
    steps: [
      "Move the e5 pawn to d6. The pawn on d5 is removed: this is en passant. The opportunity lasts only one move.",
    ],
  },
  {
    id: "queen-mate",
    title: "Checkmate with a Queen",
    subtitle: "Work with your king",
    icon: "♚",
    level: "Beginner",
    description:
      "Use your queen to restrict the enemy king, then bring your own king close enough to support the final check.",
    fen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
    moves: ["g6g7"],
    steps: [
      "Play Qg7#. Your king protects the queen, and the queen controls every escape square.",
    ],
  },
  {
    id: "ladder-mate",
    title: "The Rook Ladder",
    subtitle: "Teamwork on the ranks",
    icon: "♖",
    level: "Beginner",
    description:
      "Two rooks can push the enemy king toward the edge. One rook cuts off a rank while the other gives check.",
    fen: "7k/1R6/R7/8/8/8/8/6K1 w - - 0 1",
    moves: ["a6a8"],
    steps: [
      "Play Ra8#. Your b7 rook guards the seventh rank, so the king has no escape.",
    ],
  },
  {
    id: "skewers",
    title: "Discover the Skewer",
    subtitle: "A target behind a target",
    icon: "♗",
    level: "Intermediate",
    description:
      "A skewer attacks a valuable piece that must move, revealing another target behind it. Bishops, rooks, and queens can all create skewers.",
    fen: "4q3/3k4/8/8/2B5/8/8/6K1 w - - 0 1",
    moves: ["c4b5", "d7c7", "b5e8"],
    steps: [
      "Play Bb5+ to attack the king along the diagonal.",
      "The king steps off the diagonal.",
      "Capture the queen on e8. The skewer has worked.",
    ],
  },
];

export const openings = [
  {
    id: "italian",
    name: "Italian Game",
    eco: "C50",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    description:
      "Develop naturally and aim your bishop at f7. Prepare c3 and d4 to build a strong center.",
  },
  {
    id: "ruy-lopez",
    name: "Ruy Lopez",
    eco: "C60",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
    description:
      "Put pressure on the knight that defends e5. Castle early and keep your central options open.",
  },
  {
    id: "sicilian",
    name: "Sicilian Defense",
    eco: "B20",
    moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"],
    description:
      "Black challenges the center from the flank. The open c-file and unbalanced pawn structure create dynamic play.",
  },
  {
    id: "french",
    name: "French Defense",
    eco: "C00",
    moves: ["e4", "e6", "d4", "d5"],
    description:
      "A resilient central structure. Black attacks White’s center with d5 and often follows with c5.",
  },
  {
    id: "caro-kann",
    name: "Caro-Kann Defense",
    eco: "B10",
    moves: ["e4", "c6", "d4", "d5"],
    description:
      "Support the central d5 break with c6. Black seeks a solid position while keeping the light-squared bishop free.",
  },
  {
    id: "queens-gambit",
    name: "Queen’s Gambit",
    eco: "D06",
    moves: ["d4", "d5", "c4"],
    description:
      "Offer the c-pawn to pull Black’s d-pawn away from the center. Develop quickly and maintain central space.",
  },
  {
    id: "london",
    name: "London System",
    eco: "D02",
    moves: ["d4", "d5", "Nf3", "Nf6", "Bf4"],
    description:
      "Bring the bishop outside the pawn chain before playing e3. A steady setup with clear development plans.",
  },
  {
    id: "kings-indian",
    name: "King’s Indian Defense",
    eco: "E60",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"],
    description:
      "Fianchetto the bishop and castle, then strike at White’s center with d6 and e5 or c5.",
  },
  {
    id: "scotch",
    name: "Scotch Game",
    eco: "C45",
    moves: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4"],
    description:
      "Open the center early and give your pieces active squares. Keep an eye on the pressure along the e-file.",
  },
  {
    id: "english",
    name: "English Opening",
    eco: "A10",
    moves: ["c4", "e5", "Nc3", "Nf6", "g3"],
    description:
      "Control d5 from the flank and prepare to develop the bishop to g2. Flexible move orders allow many central structures.",
  },
];

export const practice = [
  {
    id: "queen-ending",
    title: "Queen & King",
    subtitle: "Finish the mating net",
    icon: "♕",
    fen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
    goal: "checkmate",
    description:
      "Coordinate your king and queen to deliver mate without stalemating the opponent.",
  },
  {
    id: "two-rooks",
    title: "Two Rooks",
    subtitle: "Build a mating ladder",
    icon: "♜",
    fen: "7k/1R6/R7/8/8/8/8/6K1 w - - 0 1",
    goal: "checkmate",
    description:
      "Use one rook to cut off the king and the other to deliver check.",
  },
  {
    id: "rook-ending",
    title: "Rook & King",
    subtitle: "Bring your king into action",
    icon: "♖",
    fen: "7k/8/5K2/8/8/8/8/R7 w - - 0 1",
    goal: "checkmate",
    description:
      "Shrink the enemy king’s space and bring your own king closer to support the rook.",
  },
  {
    id: "pawn-race",
    title: "Pawn Promotion",
    subtitle: "Turn a pawn into a queen",
    icon: "♙",
    fen: "k7/2P4R/1K6/8/8/8/8/8 w - - 0 1",
    goal: "checkmate",
    description: "Promote the pawn with check and finish the game.",
  },
];
