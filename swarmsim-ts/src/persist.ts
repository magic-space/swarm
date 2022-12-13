// based on:
// https://gitlab.com/erosson/swarm-elm/-/blob/master/packages/www/src/persist.js
// https://github.com/swarmsim/swarm/blob/6c6b73889d253e5382cbcf2bdd6270b171a4484e/app/scripts/services/session.coffee#L53
// https://github.com/swarmsim/swarm/blob/6c6b73889d253e5382cbcf2bdd6270b171a4484e/app/scripts/services/session.coffee#L110
import LZ from "lz-string";
import * as IO from "io-ts";
import * as E from "fp-ts/Either";
import * as A from "fp-ts/Apply";
import * as IOT from "io-ts-types";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/lib/function";

export const Base64 = IO.string.pipe(
  new IO.Type(
    "Base64",
    IO.string.is,
    (input: string, c) => {
      const out = Buffer.from(input, "base64").toString("utf8");
      // Buffer ignores invalid characters or bogus encoding, instead of
      // throwing an error, so detect errors by comparing to the original
      if (Base64.encode(out) !== input) {
        return IO.failure("Invalid base64 encoding", c);
      }
      return IO.success(out);
    },
    (output: string) => Buffer.from(output, "utf8").toString("base64")
  )
);

export const LZString = IO.string.pipe(
  new IO.Type(
    "LZString",
    IO.string.is,
    (input: string, c) => {
      const ret = LZ.decompressFromBase64(input);
      // decompress returns "" on error. But "" is valid output too, since we
      // can compress ""! Special-case that one.
      return ret === null || (ret === "" && input !== "Q===")
        ? IO.failure("Invalid lz-string encoding", c)
        : IO.success(ret);
    },
    LZ.compressToBase64
  )
);

const encPrefix = Base64.encode("Cheater :(\n\n");
const versionDelim = "|";

const SwarmBody = LZString.pipe(IOT.JsonFromString, "SwarmBody");

export const SwarmHeaders = IO.type({
  version: IOT.optionFromNullable(IO.string),
  body: IOT.Json,
});
export type SwarmHeaders = IO.TypeOf<typeof SwarmHeaders>;
export const FromSwarmHeaders = IO.string.pipe(
  new IO.Type(
    "SwarmHeaders",
    SwarmHeaders.is,
    (enc: string, c) => {
      // ignore whitespace
      enc = enc.replace(/\s+/g, "");
      // try to parse the version prefix. Some very old savestates might not have one.
      let encBody: string, version: IO.Validation<O.Option<string>>;
      if (enc.indexOf(versionDelim) >= 0) {
        const split = enc.split(versionDelim);
        version = pipe(split[0], (s) => Base64.validate(s, c), E.map(O.some));
        encBody = split[1];
      } else {
        encBody = enc;
        version = E.right(O.none);
      }
      if (!encBody.startsWith(encPrefix)) {
        return IO.failure("body prefix missing", c);
      }
      const body = SwarmBody.validate(encBody.slice(encPrefix.length), c);
      return A.sequenceS(E.Apply)({ version, body });
    },
    (dec: SwarmHeaders): string =>
      O.fold(
        () => [],
        (v: string) => [Base64.encode(v), versionDelim]
      )(dec.version)
        .concat([encPrefix, SwarmBody.encode(dec.body)])
        .join("")
  )
);
