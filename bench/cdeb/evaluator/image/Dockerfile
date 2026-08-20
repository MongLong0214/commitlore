# CDEB evaluator image (PRD §12.1).
#
# The base image is pinned by DIGEST at build time: resolve
# `node:22-alpine` with `docker manifest inspect`, substitute the digest on
# the FROM line, and record both in the freeze manifest. A tag-only FROM is
# a protocol violation — the freeze gate refuses it (CDEB-11).
#
# The engine is copied from the pinned build context (runner-oci.ts's
# ENGINE_CONTEXT_FILES, verified against evaluatorImageContextDigest()).
# Nothing from the candidate tree ever enters this image, and the candidate
# tree never enters this image at build time either: it is bind-mounted
# read-only at /input at run time, by runner-oci.ts.
#
# Trust model inside the container: the entrypoint runs privileged (root
# user of a caps-dropped, read-only, network-less container) because every
# probe it spawns DROPS to uid/gid 65534 (probe.ts). /cdeb is root-owned and
# unreadable by anyone else, so candidate code executing in a probe cannot
# read the engine sources or the sealed task module — §12.3's hidden-path
# prohibition, enforced by file modes instead of by hoping.
#
# No npm install runs here: the engine has no JavaScript dependencies, and a
# network fetch at image build would be contents the pin must then vouch for.
#
# It does need `git`. `freeze-tree.ts` and `git-tree.ts` both spawn it, and
# `node:22-alpine` does not ship it — so every evaluation inside the container
# died on `git init ... failed`. The comment here used to say the engine had
# "zero dependencies beyond the node runtime itself", which was a claim about
# the image nobody had run. `apk` installs exactly one package from the pinned
# base's own index; that is a smaller surface than an npm tree and it is the
# only way the engine works at all.
FROM node:22-alpine

RUN apk add --no-cache git

ENV TZ=UTC LC_ALL=C LANG=C NODE_OPTIONS= HOME=/tmp

WORKDIR /cdeb
COPY engine/ /cdeb/engine/
# `engine/tree.ts` imports `../runtime/zstd.ts`, so the engine alone is not a
# runnable image. It was never noticed because nothing built this image and ran
# it: the isolation tests asserted the `docker run` argv, which is satisfied by
# an image that cannot start.
COPY runtime/ /cdeb/runtime/
COPY cdeb-evaluate.sh /cdeb/evaluate
RUN chmod 0555 /cdeb/evaluate \
    && chmod -R go-rwx /cdeb \
    && chmod -R a-w /cdeb

ENTRYPOINT ["/cdeb/evaluate"]
