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

## Character artwork and original voices

群星图鉴 uses original Genshin Impact character artwork, talent icons and voice
recordings. These remain the rights holders' game content, separate from this
project's MIT license. Image identity mappings come from
`theBowja/genshin-db` at `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`,
`src/data/image/characters.json`; image delivery currently uses
`https://gi.yatta.moe/assets/UI/` and is verified per source identifier.

Original voice availability is indexed from
[simon3000/genshin-voice](https://huggingface.co/datasets/simon3000/genshin-voice/tree/68950dc52d799876d1e64c1ab6c47955502e79a1/speaker-archives),
revision `68950dc52d799876d1e64c1ab6c47955502e79a1`. The publisher's original
resource-path hash mapping identifies individual WAV members. The service reads
only a selected clip using bounded byte ranges and validates its size, CRC and
audio format. The full voice corpus is not downloaded or bundled with the code.
Credit belongs to the game's creators, performers and the dataset maintainer;
the dataset's availability does not change underlying game-content rights.

Two local portrait supplements are original Genshin Impact artwork mirrored by
[Rollphes/genshin-manager](https://github.com/Rollphes/genshin-manager/tree/cfea64f3f4afbfb8cf6fd3c35088c78528515ca8/initImages),
commit `cfea64f3f4afbfb8cf6fd3c35088c78528515ca8`. The
[Traveler portrait manifest](apps/web/public/assets/genshin-ui/traveler/manifest.json)
records the matching Avatar identities, original paths, dimensions, Git blobs
and SHA-256 hashes. These supplements are separate from snapshot media coverage
and retain the underlying game-content rights.

## Navigation, element, property and rarity sprites

The module navigation, element, character property and rarity sprites are unmodified
original Genshin Impact UI sprites from the community mirror
[PathOfGenshin/resources](https://github.com/PathOfGenshin/resources/tree/015a2493b5672b28576ab78ffbcffde2ea0c9844/resources/gi/Sprite),
commit `015a2493b5672b28576ab78ffbcffde2ea0c9844`. Original filenames, source URLs,
dimensions and verified hashes are recorded in
[the asset manifest](apps/web/public/assets/genshin-ui/manifest.json).
They remain miHoYo / HoYoverse game artwork; the mirror's software license and
this project's MIT license do not grant rights to the underlying images.

## Archive typography

Noto Sans SC variable font subsets are distributed under the
[SIL Open Font License 1.1](apps/web/public/assets/fonts/archive/OFL.txt).
The `ArchiveUI` CSS family points to the original self-hosted WOFF2 bytes.
The [font manifest](apps/web/public/assets/fonts/archive/manifest.json) lists the
source CSS, upstream subset URLs, sizes and SHA-256 hashes.

## Software and model dependencies

JavaScript and Python packages retain their upstream licenses; exact installed
versions are tracked by package-lock.json and services/knowledge/uv.lock. Container
base images retain their own notices. E5 model weights are separate artifacts:
review the license and model card of the exact pinned
[intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)
revision before downloading or deploying. Generated answers may quote source game
text and must retain their citations; they are not official game statements.
