# NOTE (2026-08-19): the committed GIF was not produced by this tape.
# `vhs` needs `ttyd`, and on the machine that made it Homebrew refused every
# ffmpeg-dependent formula because a third-party tap was registered and
# untrusted -- granting that trust is a decision about somebody's machine, not
# a build step. The GIF was rendered instead from the bytes `commitlore demo`
# actually printed, wrapped the way a 65-column terminal wraps them, at the
# font, palette and framerate this tape specifies. Nothing in it was authored
# by hand.
#
# This tape is kept because it is the reproducible path: with `vhs` available,
# `vhs assets/readme/demo.tape` regenerates the GIF from the live command, and
# a recording whose source is thrown away cannot be checked against what it
# claims to show.

# Source for assets/readme/demo.gif — regenerate with: vhs assets/readme/demo.tape
#
# The GIF is committed and the tape is committed beside it. A recording whose
# source is thrown away cannot be checked against the command it claims to
# show, and this one shows a real `commitlore demo` run: no hand-authored
# output, no fake agent chat, nothing the CLI cannot print.

Output assets/readme/demo.gif

Set Shell "bash"
Set FontSize 26
Set Width 1100
Set Height 640
Set Padding 26
Set Framerate 12
Set TypingSpeed 35ms
Set Theme {
  "background": "#0D1117",
  "foreground": "#F0F6FC",
  "black": "#161B22",
  "brightBlack": "#8B949E",
  "green": "#3FB950",
  "brightGreen": "#3FB950"
}

Sleep 1s
Type "commitlore demo"
Sleep 400ms
Enter
Sleep 9s
