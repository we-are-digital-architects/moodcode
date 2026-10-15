// Each grid face drawn as a 9x4 picture: a solid round head in quadrant blocks, the eyes and mouth cut out.
// A quadrant character holds 2x2 pixels, so a face is an 18x8 pixel drawing.
export const DRAWN_WIDTH = 9
export const DRAWN_ROWS = 4

export const DRAWN: Readonly<Record<string, readonly string[]>> = {
  '(>_<)': [ // frustrated
    ' ▄█████▄ ',
    '▟█▝███▘█▙',
    '▜██▀▀▀██▛',
    ' ▀▙███▟▀ ',
  ],
  '(O_O)': [ // surprised
    ' ▄█████▄ ',
    '▟█ ███ █▙',
    '▜███▀███▛',
    ' ▀██▄██▀ ',
  ],
  'd(^O^)b': [ // excited
    ' ▄█████▄ ',
    '▟▛▄▜█▛▄▜▙',
    '▜█▛▀▀▀▜█▛',
    ' ▀█▄▄▄█▀ ',
  ],
  '(._.)': [ // unhappy
    ' ▄█████▄ ',
    '▟█▘███▝█▙',
    '▜██▛▀▜██▛',
    ' ▀█▟█▙█▀ ',
  ],
  '(^.^)': [ // neutral
    ' ▄█████▄ ',
    '▟█ ███ █▙',
    '▜██▜█▛██▛',
    ' ▀█▙▄▟█▀ ',
  ],
  '(^o^)': [ // happy
    ' ▄█████▄ ',
    '▟█ ███ █▙',
    '▜█▛███▜█▛',
    ' ▀█▄▄▄█▀ ',
  ],
  '(-_-)': [ // weary
    ' ▄█████▄ ',
    '▟▛▀▜█▛▀▜▙',
    '▜██▀▀▀██▛',
    ' ▀█████▀ ',
  ],
  '(o_O)': [ // unsure
    ' ▄█████▄ ',
    '▟█▀███ █▙',
    '▜███▛▀██▛',
    ' ▀█▄▟██▀ ',
  ],
  '(^-^)': [ // content
    ' ▄█████▄ ',
    '▟▛▄▜█▛▄▜▙',
    '▜█▛███▜█▛',
    ' ▀█▄▄▄█▀ ',
  ],
}
