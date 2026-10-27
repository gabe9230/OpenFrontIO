# Train deliveries

Each train spawns at its origin and can make multiple stops on its route to
its selected destination. Every visited city or port pays once, including
intermediate stations. The train despawns at the final destination.
Destroyed trains and broken routes do not earn payouts for stops not reached;
money already earned at earlier stops is retained.

Each city or port stop uses that building's level and owner at arrival:

```text
gold = floor(base × (1 + visitedBuildingLevel / 10) × goldMultiplier)
```

| Visited building's relationship  |    Base |
| -------------------------------- | ------: |
| Own building                     |  50,000 |
| Allied player                    | 150,000 |
| Teammate or other trading player | 100,000 |

The level bonus adds 10% of the base per level, matching these examples at a
1× game gold multiplier:

- Allied level 10 city: 150,000 × 2 = **300,000**.
- Other player's level 5 city: 100,000 × 1.5 = **150,000**.
- Own level 1 city: 50,000 × 1.1 = **55,000**.

For stops at another player's building, both the train owner and building owner receive
the full calculated payout, preserving the existing trade-sharing rule.
Factories still spawn trains; their spawn frequency and train capacity rules
are unchanged. Factory visits do not generate delivery revenue.
There is no payout penalty for visiting more stations.
