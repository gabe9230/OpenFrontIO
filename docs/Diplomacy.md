# Diplomacy

Every pair of players starts **Neutral**. Relations are mutual and follow four
tiers, from highest to lowest: **Allied → Neutral → Cold War → War**.

| Tier     | Piracy    | Betrayal penalty when invaded      |
| -------- | --------- | ---------------------------------- |
| Allied   | Protected | Existing alliance betrayal penalty |
| Neutral  | Protected | None                               |
| Cold War | Allowed   | None                               |
| War      | Allowed   | None                               |

Use the up/down arrows in a player's right-click menu to change relations.
Raising relations proposes the next tier and requires the other player's
approval. Lowering relations takes effect immediately for both sides. Breaking
an alliance retains the existing betrayal rules; further downgrades have no
betrayal penalty. The hovered player's card shows the current diplomacy tier.

A valid land invasion, naval invasion, or nuke launch automatically declares War
with its target. Invalid attacks without a front and failed launches do not.
Nuclear collateral damage retains the existing threshold for declaring War with
additional countries. A hostile action invalidates pending peace proposals.
Approving peace stops land/naval invasions and cancels the existing nuclear
strikes between those two players.

Trade ships are protected if either their owner or destination owner is Allied
or Neutral with a potential pirate. Existing safe-passage cooldowns also apply.
Warships automatically engage military ships only at War; Cold War permits
piracy without automatically starting a naval battle.

Diplomacy arrows and human approvals create alliances lasting until relations
change. Legacy AI-to-AI requests retain their existing configured duration.
Teams retain their existing restrictions. Each player keeps their own army;
alliances grant no shared manpower or attack fronts across another border.
