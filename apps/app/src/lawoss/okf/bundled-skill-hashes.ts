/**
 * SHA-256 of every SKILL.md body LAWOSS has ever bundled for the OKF skills
 * (novy-spis SK and CS, okf-pamat, usporiadaj-spis), including `dev` 39a27747
 * and #105. An installed body with one of these hashes is unmodified and may be
 * replaced by the current bundle; any other body is a user customization.
 *
 * The hash is taken over `installedSkillBody()` of the stored file: frontmatter
 * removed, CRLF as LF, trimmed, one trailing newline. Generated from
 * `git log --follow --full-history` of the four files plus HEAD; when a bundled
 * SKILL.md changes, add the new hash here (a test fails until it is listed).
 */
export const BUNDLED_OKF_SKILL_HASHES: ReadonlySet<string> = new Set([
  "01de6798b2d44beedba136b36b8741732db60f2974a82e5d2b75c0c01391508e", // lawoss/okf-pamat/SKILL.md @ 04d3d2dc
  "04f60d70f08f79216840bb867333255668170d2bab7d7126693fc7f6f2003d71", // lawoss/okf-pamat/SKILL.md @ 168221d2
  "0620619c4340d3dc6ed90f4115e005e00da68308048d26e224c676118c6ad663", // lawoss/skills/novy-spis/SKILL.md @ f253188a
  "0782b3b9aded745def112d42c2dc379015a07aac03e8a393bfa1b1b8b9aa79eb", // lawoss/okf-pamat/SKILL.md @ a4b540e2
  "0f68063b78c5df2d28b1fd525966889640d4aa9f8f5f5a8f969f6d243f62b7ba", // lawoss/okf-pamat/SKILL.md @ 61422e82
  "0f824e3f65eee0e2851a483713b951fb23fe73ff51b95ca68b4caec92917a2bf", // lawoss/okf-pamat/SKILL.md @ 0daa193a
  "1309443309d798500f740d9efbd6ea2a27bda441499baa0b3bfb6814280bdf73", // lawoss/skills/usporiadaj-spis/SKILL.md @ 0e0f8f76
  "17c279e7a27cb2b930e36f5cdcd9e9989d71c2bdfaaf5284b07df53778f6a034", // lawoss/okf-pamat/SKILL.md @ 4ea8c747
  "1aa12936d3e1c74377808cf4e32e2fdb843323ebbdcefe73199cd91e783f80fe", // lawoss/skills/novy-spis/SKILL.md @ bb5e869c
  "216dc56f9257ad5681d74935f6b2954ed6d56d6d5008ebc361985ac9e0fd9178", // lawoss/skills/novy-spis/SKILL.md @ caacdf9c
  "2571048a4af6d4375faf682a0f4b67c4c21bd78483d3d1e7e7ef76fe768edef0", // lawoss/okf-pamat/SKILL.md @ 0fa9dfbb
  "31056d6d659154f8d5b18f5a4c4a80b674725eb28b62dbea730ef6d7b82a44a3", // lawoss/okf-pamat/SKILL.md @ 540df6cc
  "376b579194aa6b8f484050dd2fba08161a417c0c19831f2016852e33e16b70c0", // lawoss/okf-pamat/SKILL.md @ 55159fbb
  "38b1727bbee79e01ca9a5b8852adbe954937815248c132691ebc6f9c34323b18", // lawoss/skills/novy-spis/SKILL.md @ f8153756
  "4996b5a816e15c26fe82a9f4028d5bf4e9cd88151c88d86f686a0d6d68fc6c09", // lawoss/okf-pamat/SKILL.md @ ef1fb80d
  "4a16ec42703a7f82276f1b908112162e0e5e77ebfdf9090f392b2735f3aa41ff", // lawoss/okf-pamat/SKILL.md @ de1b1075
  "4abb5a8ec848802c1fea97452d6619fc6a43ec6b21259672866a6d83498dadce", // lawoss/okf-pamat/SKILL.md @ 793ec793
  "5626a0d6950460f6c7ac1269cd9dd533dd85d63582015a2286694a2b0816b79d", // lawoss/okf-pamat/SKILL.md @ 21a4bc44
  "5a4e2523f4cf7fce2827101e9dbbf2647ef00274a3302172e1f36c14df2568c6", // lawoss/skills/novy-spis/SKILL.cs.md @ 221da141
  "620c5a37406db608c75da2e348e2b42dd75cae6ff777c6f4aee429ba5c56c2a7", // lawoss/okf-pamat/SKILL.md @ 790a86c0
  "79b13383c649b2a9ba81bcb3ab2167d48b4744a0215090d735a2e007c2c8f0f4", // lawoss/okf-pamat/SKILL.md @ 1bc3f128
  "7a4323b22532d72555d01d39b6af4857406e007b3da42d72f473861b3502e223", // lawoss/skills/novy-spis/SKILL.md @ 221da141
  "7f0a61c1851ac80de6482b72b67a6abe086710e77e9901fdbe495f65056444c8", // lawoss/okf-pamat/SKILL.md @ b3d50764
  "8919acd9afbd404f716425a1502f8fd2e1604c3855e155bb921567f92d98808b", // lawoss/okf-pamat/SKILL.md @ ccc2db0a
  "8937c0e1a2fb5c0f405866ab7fbbfad1573ee84637a079ba4bc3364221841d2a", // lawoss/okf-pamat/SKILL.md @ f6bcae3c
  "8ca9ccca2915d9030465ecddb994d788cb0eac78d50f18c15d9715693cfe76ca", // lawoss/okf-pamat/SKILL.md @ 4aa50376
  "93124c750445011a94aa1d871dbb8bca036dbb3c572931440da9e5caf28f0c80", // lawoss/okf-pamat/SKILL.md @ f0fc1a01
  "a6147662fc53862c5c362b6aa34fb188b59891c8aeea92bd2b4f7efcdcc1aef3", // lawoss/okf-pamat/SKILL.md @ e362496e
  "baae5bd4694a0c087d7874984b7d19fbda0776ea92ba8796d0a235016da51962", // lawoss/okf-pamat/SKILL.md @ 4614bc41
  "bb5fb85573e1eb75bf1b7485f6d27fd00c62ac48536f5e8dd2780c0a161db39f", // lawoss/okf-pamat/SKILL.md @ f8153756
  "c20a542047939ecc2f51646ba0c879a846e4d2faa0e04ead28cc82c53927765f", // lawoss/okf-pamat/SKILL.md @ 92e76c7e
  "c49d41dc57be0c1d03dd439feea6d5a09d2195a54d154466ab45611bff8e698e", // lawoss/skills/novy-spis/SKILL.md @ 84256f60
  "c9dc507b52c1329a4a47cdc2d01283be46a0264474b88c67495fddb80d854971", // lawoss/okf-pamat/SKILL.md @ e7fa23a0
  "d0348ac590c7bc19ac710d03ac9f60968bd74946884669d7587158e0ec63a5c1", // lawoss/okf-pamat/SKILL.md @ 055995f6
  "e59f795713a1609cdab1daa9e8b6377a38afe23a87d0700d06750c776df16c1c", // lawoss/okf-pamat/SKILL.md @ e0e3fd84
  "ea509e81c1860a6f4d34eae676e09a33d1b9ddb5e051e37aa21e950fc4c24928", // lawoss/skills/novy-spis/SKILL.md @ baa75858
  "f155b0cd265834f12efafaebe9dc5253a1b5db8484eec556c19761870a822a13", // lawoss/skills/novy-spis/SKILL.md @ 61422e82
  "f20e0208616f3fe50860caa94cbc004e776582d41948fbac278abfba224df922", // lawoss/skills/usporiadaj-spis/SKILL.md @ 0f9681d3
  "f7eee8ca3806176713d3d49afd5a08ca7850e756be9acd0f03c3575aaa57d82d", // lawoss/okf-pamat/SKILL.md @ b03f82fe
  "f872ac3d24a2b2bc2ce83a12c086fae5358ad8c64f66eb6c757adcf6d3c84191", // lawoss/skills/novy-spis/SKILL.cs.md @ caacdf9c
]);
