# Unprompted reactions in whitelisted channels

Gnomo reacts with one emoji to roughly one in every 8-16 human messages in channels listed in
`AMBIENT_REACTION_CHANNEL_IDS`, without being mentioned, to keep the chat lively. Until now, only
messages that mention Gnomo reached the model. With this feature, the text of the message that
gets the reaction (at most 1000 characters, with no author, history or attachments) is also sent to
the model so it can pick the emoji. The model can only return an emoji, which the code validates
against the server's custom emojis or a single standard emoji, so the message cannot trigger any
other action. Nothing is stored except the per-channel countdown in Redis.

We accept this narrow data flow for the social value of the feature. It is opt-in per channel, off
by default, and subject to the same deployment policy and live channel access checks as a tagged
request. Messages that mention Gnomo never count toward the countdown.
