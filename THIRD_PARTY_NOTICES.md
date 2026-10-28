# Third-party notices

void-terminal is an independent fan project, unaffiliated with and not endorsed
by HoYoverse, miHoYo or Genshin Impact. Names, artwork and game content belong to
their respective rights holders. The MIT license covers this project's original
code, not third-party assets or imported game text.

## Official scenery

The Sumeru scenery used in the design and interface is official Genshin Impact
artwork. Sources were checked on 2026-10-28:

- Official world page: <https://genshin.hoyoverse.com/en/map>.
- Main world background: <https://act-webstatic.hoyoverse.com/upload/contentweb/2022/08/16/8969f683b92839ac427c875d0d742be2_4596868760376591695.jpg>.
- Sumeru City reference: <https://act-webstatic.hoyoverse.com/upload/contentweb/2022/08/16/e577d144db87b02fcd98a95d7c664724_4936581560586959253.jpg>.

The original local files and provenance are recorded in
[scenery-sources.md](docs/design/genshin-v2/assets/scenery-sources.md). Public CDN
availability does not establish permission to redistribute. Operators must
review applicable usage terms before publishing or redistributing artwork.

## Imported source data

Ingestion must preserve upstream repository, exact commit, file path and locator
for each record. Upstream datasets, game text and extracted assets retain their
own licenses and rights. Review the selected repository's license and game-content
terms before fetching, hosting, or redistributing. Repository availability alone
is not a license. Data is not bundled as a complete game corpus with this code.

The default pinned inputs are:

- [DimbreathBot/AnimeGameData](https://github.com/DimbreathBot/AnimeGameData), commit
  `792978e5503ecfba73dcb3562ed44a0d35a2abe2`. Its README requests attribution;
  the checked source did not provide a general LICENSE for game content.
- [theBowja/genshin-db](https://github.com/theBowja/genshin-db), commit
  `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`. Its repository declares MIT;
  retain its [license notice](https://github.com/theBowja/genshin-db/blob/49a6544a6c6ae36089cb42fa591fc46f01de8bcf/LICENSE)
  when redistributing its covered material. Underlying game-content rights remain separate.

## Software and model dependencies

JavaScript and Python packages retain their upstream licenses; exact installed
versions are tracked by package-lock.json and services/knowledge/uv.lock. Container
base images retain their own notices. E5 model weights are separate artifacts:
review the license and model card of the exact pinned
[intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)
revision before downloading or deploying. Generated answers may quote source game
text and must retain their citations; they are not official game statements.
