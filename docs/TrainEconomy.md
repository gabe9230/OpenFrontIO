# Train deliveries

Each train is one delivery: it spawns at its origin, travels to its selected
destination, despawns, then pays once. It can pass rail junctions and other
stations along the path, but those are not stops and earn no money from it.
Destroyed trains, destroyed destinations and broken routes do not pay.

City and port deliveries use the destination building's level at arrival:

```text
gold = floor(base × (1 + destinationLevel / 10) × goldMultiplier)
```

| Destination relationship         |    Base |
| -------------------------------- | ------: |
| Own building                     |  50,000 |
| Allied player                    | 150,000 |
| Teammate or other trading player | 100,000 |

The level bonus adds 10% of the base per level, matching these examples at a
1× game gold multiplier:

- Allied level 10 city: 150,000 × 2 = **300,000**.
- Other player's level 5 city: 100,000 × 1.5 = **150,000**.
- Own level 1 city: 50,000 × 1.1 = **55,000**.

For external deliveries, both the train owner and destination owner receive
the full calculated payout, preserving the existing trade-sharing rule.
Factories still spawn trains; their spawn frequency and train capacity rules
are unchanged. Factory visits do not generate delivery revenue.
