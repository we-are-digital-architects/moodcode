# moodcode

Claude Code, now with feelings. `(^o^)`

Gives Claude Code a mood that changes as you talk. Whenever the mood changes, Claude's face is drawn beside the reply, and replies stay short, simple and human.

```
❯ hi, what does git stash do?
 ▄█████▄
▟█ ███ █▙  ⏺ git stash shelves your uncommitted changes and gives you a clean working
█████████    directory. Bring them back later with git stash pop.
▜██▞▀▚██▛
 ▀█████▀
❯ and what does git stash list show?
⏺ git stash list shows every stash you saved, newest first.
❯ thanks, that really helps!
 ▄█████▄
▟█ ███ █▙  ⏺ Glad it helped! Let me know if you have any other git questions.
█████████
▜█▞▜█▛▚█▛
 ▀█▙▄▟█▀
```

Nine faces cover the mood, from worked up to calm and from unhappy to happy. Each also has a one-line form:

```
              unhappy            neutral           happy
worked up     (>_<)  frustrated  (O_O)  surprised  d(^O^)b  excited
normal        (._.)  unhappy     (^.^)  neutral    (^o^)    happy
calm          (-_-)  weary       (o_O)  unsure     (^-^)    content
```

Claude starts at `(^.^)`, and the face shows on the first reply and then only when it changes. Thanks and praise lift the mood. Asking the same question again, even in other words, wears it down. When you work something out correctly, Claude may brighten in the same reply. Mood drifts back toward neutral over a few calm turns, and a new session or `/clear` starts fresh.

Only the chat text changes. Code, commands, file edits, commit messages and PR text are written normally.

## Install

Requires Claude Code **2.1.299 or newer**. The plugin uses the mods API, which is in early access and may change between releases.

At the prompt of a terminal session:

```
/plugin install moodcode --marketplace we-are-digital-architects/moodcode
```

Answer `y` to add the marketplace, then choose a scope.

## Use

| Command | What it does |
|---|---|
| `/mood` | Current mood, why it last changed, and the last five turns |
| `/mood off` | Plain Claude replies for this session |
| `/mood on` | Mood back on |

Settings in `/config`:
- **Background mood judge** (on by default): after each reply, a small model reviews the exchange and adjusts the mood. Off means instant rules only.
- **Judge model**: `haiku` (default) or `sonnet`.
- **Face style**: `drawn` (default), the 9x5 face beside the reply, or `line`, the one-line face at its start. Other surfaces (desktop, VS Code) and terminals narrower than 60 columns use the one-line face.

## How it works

Each message you send goes through instant word rules (thanks, praise, complaints) and a repeat check, which compares word overlap with your last five messages. That takes milliseconds, so the mood is ready before Claude answers. After the reply, the judge model looks at the exchange in the background and its verdict applies to your next message. No reply ever waits for it.

## Privacy

The judge sends your latest message and Claude's reply (each cut to 2,000 characters) to the configured model, on your own Claude account. The plugin store keeps only mood numbers, short hashes of the words in your last five messages (not the words themselves; they spot repeated questions, and messages of more than 200 distinct words are skipped), and the judge's short reasons. It never stores your messages. Sessions older than seven days are deleted.

## Other style plugins

moodcode works alongside plugins and settings that change Claude's tone (for example caveman). They keep control of wording and length; moodcode adds the mood face in front.

## License

MIT
