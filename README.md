# @opencanviz/player

The source of [`@opencanviz/player`](packages/player/README.md), the MIT-licensed player for
[openCanviz](https://opencanviz.com) animated explainers. It draws the same frames as
opencanviz.com and its MP4 export.

This repository is a mirror. openCanviz is developed in a private repository, and this one
receives only the files the player is built from, at the same paths they have there. Synced
from openCanviz commit `acc235b`.

```sh
npm install
npm run build   # writes packages/player/dist
```

Usage, options and the document format are in [packages/player/README.md](packages/player/README.md).

## Contributing

Issues and pull requests are welcome. A merged change is ported into openCanviz and arrives
back here with the next sync, so the commit history here is sync commits rather than the
original ones.

## License

MIT, see [LICENSE](LICENSE). The fonts in `public/fonts` are under the SIL Open Font License,
see [packages/player/FONTS-OFL.txt](packages/player/FONTS-OFL.txt).
