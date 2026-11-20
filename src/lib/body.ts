// Body chart anatomy (change request, 20 Nov 2026): a side view of the whole animal for dogs, cats, hamsters, turtles
// and birds. Drawn facing left = the pet's RIGHT side; the Left-side view is the same drawing mirrored. Limbs, ears and
// wings come in pairs: the one nearer the viewer is drawn in front, the far one behind and darker, and both can be
// picked — '_NEAR' / '_FAR' in a part id become '_R' / '_L' depending on the side shown.
import { mixHex, shadeHex } from './dental';

export const BODY_SPECIES = ['DOG', 'CAT', 'HAMSTER', 'TURTLE', 'BIRD'] as const;
export type BodyAnimal = (typeof BODY_SPECIES)[number];
export const hasBody = (species: string): species is BodyAnimal => (BODY_SPECIES as readonly string[]).includes(species);
export type BodySide = 'R' | 'L';

/** How a shape is coloured. */
export type Role =
  | 'coat' | 'belly' | 'face' | 'skin' | 'nose' | 'lip' | 'pad' | 'eye' | 'tooth' | 'beak' | 'cere'
  | 'shell' | 'plastron' | 'scale' | 'scale2';

export interface Shape { part: string; d: string; role: Role; far?: boolean; clip?: boolean }
export interface Decor { d: string; stroke?: string; fill?: string; w?: number; far?: boolean; clip?: boolean }
export interface BodyModel {
  w: number;
  h: number;
  /** The trunk outline; shapes with clip: true are cut to it (the trunk's regions). */
  torso: string;
  shapes: Shape[];
  /** Lines and details on top of the parts (whiskers, scutes, claws…), not clickable. */
  decor: Decor[];
  /** Where a finding is drawn on each part: x, y and a size. */
  anchors: Record<string, [number, number, number]>;
  /** Parts with no single place on the drawing (whole coat, body condition): picked from the list. */
  listOnly: string[];
  /** Fur, feathers or scales texture. */
  texture: 'fur' | 'feather' | 'scale';
}

// ---------------------------------------------------------------- drawings (viewBox 0 0 w h, facing left)
const DOG: BodyModel = {
  w: 640, h: 380, texture: 'fur',
  torso: 'M 182 196 C 180 158 214 140 258 140 L 398 146 C 446 148 474 172 472 208 C 470 238 448 252 420 250 L 382 240 C 334 254 272 270 226 270 C 196 268 184 236 182 196 Z',
  shapes: [
    { part: 'FORELEG_FAR', role: 'belly', far: true, d: 'M 232 236 L 262 238 C 264 270 260 300 258 328 L 256 340 L 236 340 C 237 316 238 290 232 262 Z' },
    { part: 'FOREPAW_FAR', role: 'belly', far: true, d: 'M 256 336 L 234 336 C 220 338 216 348 224 353 L 260 353 C 264 348 262 341 256 336 Z' },
    { part: 'HINDLEG_FAR', role: 'coat', far: true, d: 'M 376 206 C 414 206 436 228 432 256 C 430 274 416 288 406 298 L 412 338 L 392 340 L 386 302 C 376 288 368 270 368 250 Z' },
    { part: 'HINDPAW_FAR', role: 'belly', far: true, d: 'M 412 334 L 390 334 C 376 336 372 346 380 352 L 416 352 C 420 346 418 339 412 334 Z' },
    { part: 'TAIL', role: 'coat', d: 'M 462 168 C 494 152 518 122 528 96 C 532 88 542 91 540 100 C 532 132 506 166 470 186 Z' },
    { part: 'PERINEUM', role: 'skin', d: 'M 464 180 C 474 186 478 204 471 216 C 462 210 459 192 464 180 Z' },
    { part: 'BACK', role: 'coat', clip: true, d: 'M 150 100 L 405 100 L 405 186 L 150 186 Z' },
    { part: 'CHEST', role: 'belly', clip: true, d: 'M 150 186 L 275 186 L 275 300 L 150 300 Z' },
    { part: 'ABDOMEN', role: 'belly', clip: true, d: 'M 275 186 L 405 186 L 405 300 L 275 300 Z' },
    { part: 'RUMP', role: 'coat', clip: true, d: 'M 405 100 L 520 100 L 520 300 L 405 300 Z' },
    { part: 'NECK', role: 'coat', d: 'M 196 160 C 188 128 168 104 146 96 L 118 122 C 132 150 154 182 184 204 Z' },
    { part: 'EAR_FAR', role: 'coat', far: true, d: 'M 128 66 C 136 56 150 58 154 70 L 142 78 Z' },
    { part: 'HEAD', role: 'coat', d: 'M 96 80 C 104 60 146 56 162 76 C 172 92 166 118 146 128 L 104 124 C 94 112 90 94 96 80 Z' },
    { part: 'MUZZLE', role: 'belly', d: 'M 104 96 C 84 92 62 95 54 104 C 49 112 55 121 66 123 L 110 124 Z' },
    { part: 'MOUTH', role: 'lip', d: 'M 58 119 C 72 126 96 128 112 122 L 112 127 C 96 133 72 132 58 123 Z' },
    { part: 'NOSE', role: 'nose', d: 'M 44 102 C 44 96 52 94 58 97 C 62 100 61 108 56 110 C 50 112 44 108 44 102 Z' },
    { part: 'EYES', role: 'eye', d: 'M 112 88 C 117 82 126 82 131 88 C 126 94 117 94 112 88 Z' },
    { part: 'EAR_NEAR', role: 'coat', d: 'M 136 70 C 152 66 166 80 164 108 C 162 126 150 132 143 122 C 139 104 132 88 136 70 Z' },
    { part: 'FORELEG_NEAR', role: 'belly', d: 'M 204 232 L 238 236 C 240 268 236 300 234 330 L 232 346 L 210 346 C 211 320 212 290 206 262 Z' },
    { part: 'FOREPAW_NEAR', role: 'belly', d: 'M 232 342 L 210 342 C 196 344 192 354 200 359 L 236 359 C 240 354 238 347 232 342 Z' },
    { part: 'HINDLEG_NEAR', role: 'coat', d: 'M 400 200 C 440 200 462 226 458 256 C 455 276 440 290 430 300 L 436 342 L 414 344 L 408 304 C 398 290 390 270 392 250 Z' },
    { part: 'HINDPAW_NEAR', role: 'belly', d: 'M 436 338 L 412 338 C 398 340 394 350 402 356 L 440 356 C 444 350 442 343 436 338 Z' },
  ],
  decor: [
    { d: 'M 48 101 q 3 2 6 0', stroke: '#000', w: 1.2 },
    { d: 'M 60 119 C 74 126 94 127 110 122', stroke: '#2a1c1c', w: 1.2 },
    { d: 'M 200 357 l -3 3 M 207 358 l -3 3 M 214 358 l -3 3', stroke: '#3a2f2a', w: 1.4 },
    { d: 'M 402 354 l -3 3 M 409 355 l -3 3 M 416 355 l -3 3', stroke: '#3a2f2a', w: 1.4 },
  ],
  anchors: {
    HEAD: [132, 92, 18], MUZZLE: [82, 108, 12], NOSE: [52, 103, 6], MOUTH: [86, 129, 9], EYES: [121, 88, 6],
    EAR_NEAR: [151, 100, 11], EAR_FAR: [142, 68, 7], NECK: [160, 148, 16], CHEST: [225, 226, 26], ABDOMEN: [338, 222, 28],
    BACK: [300, 162, 28], RUMP: [440, 204, 22], TAIL: [506, 132, 11], PERINEUM: [469, 198, 6],
    FORELEG_NEAR: [222, 292, 11], FOREPAW_NEAR: [218, 350, 8], FORELEG_FAR: [248, 292, 10], FOREPAW_FAR: [242, 345, 7],
    HINDLEG_NEAR: [428, 258, 15], HINDPAW_NEAR: [420, 348, 8], HINDLEG_FAR: [402, 258, 13], HINDPAW_FAR: [396, 344, 7],
  },
  listOnly: ['SKIN', 'CONDITION'],
};

const CAT: BodyModel = {
  w: 640, h: 370, texture: 'fur',
  torso: 'M 198 210 C 196 176 226 160 268 160 L 396 162 C 444 162 470 188 466 222 C 462 246 442 256 416 254 L 380 246 C 332 260 272 270 236 268 C 210 264 200 240 198 210 Z',
  shapes: [
    { part: 'FORELEG_FAR', role: 'belly', far: true, d: 'M 246 244 L 270 246 C 271 280 268 310 266 338 L 248 338 C 250 310 250 280 246 256 Z' },
    { part: 'FOREPAW_FAR', role: 'belly', far: true, d: 'M 266 334 L 248 334 C 238 336 236 344 242 348 L 268 348 C 271 344 270 338 266 334 Z' },
    { part: 'HINDLEG_FAR', role: 'coat', far: true, d: 'M 380 214 C 414 214 432 236 428 262 C 426 278 416 290 408 300 L 412 336 L 396 338 L 390 302 C 380 290 374 272 374 254 Z' },
    { part: 'HINDPAW_FAR', role: 'belly', far: true, d: 'M 412 332 L 394 332 C 384 334 382 342 388 346 L 414 346 C 417 342 416 336 412 332 Z' },
    { part: 'TAIL', role: 'coat', d: 'M 460 196 C 500 196 536 176 548 128 C 552 112 562 112 562 126 C 556 178 518 210 466 214 Z' },
    { part: 'PERINEUM', role: 'skin', d: 'M 460 202 C 469 208 470 222 464 230 C 457 224 456 210 460 202 Z' },
    { part: 'BACK', role: 'coat', clip: true, d: 'M 170 120 L 408 120 L 408 200 L 170 200 Z' },
    { part: 'CHEST', role: 'belly', clip: true, d: 'M 170 200 L 285 200 L 285 300 L 170 300 Z' },
    { part: 'ABDOMEN', role: 'belly', clip: true, d: 'M 285 200 L 408 200 L 408 300 L 285 300 Z' },
    { part: 'RUMP', role: 'coat', clip: true, d: 'M 408 120 L 520 120 L 520 300 L 408 300 Z' },
    { part: 'NECK', role: 'coat', d: 'M 212 176 C 204 152 186 136 168 132 L 150 156 C 160 176 176 196 200 214 Z' },
    { part: 'EAR_FAR', role: 'coat', far: true, d: 'M 124 102 L 128 64 L 150 92 Z' },
    { part: 'HEAD', role: 'coat', d: 'M 112 124 C 112 98 136 86 160 92 C 182 98 188 124 176 144 C 164 158 128 160 114 146 Z' },
    { part: 'MUZZLE', role: 'belly', d: 'M 116 130 C 104 130 96 139 99 148 C 104 156 120 158 130 150 C 133 141 126 132 116 130 Z' },
    { part: 'MOUTH', role: 'lip', d: 'M 101 150 C 107 156 118 157 126 152 L 124 158 C 116 162 105 160 100 154 Z' },
    { part: 'NOSE', role: 'nose', d: 'M 95 136 L 105 135 L 100 142 Z' },
    { part: 'EYES', role: 'eye', d: 'M 121 119 C 127 111 138 111 143 119 C 138 126 127 126 121 119 Z' },
    { part: 'EAR_NEAR', role: 'coat', d: 'M 142 98 L 154 58 L 176 104 Z' },
    { part: 'FORELEG_NEAR', role: 'belly', d: 'M 218 240 L 246 244 C 248 278 245 310 243 340 L 224 340 C 225 312 225 282 220 258 Z' },
    { part: 'FOREPAW_NEAR', role: 'belly', d: 'M 243 336 L 224 336 C 213 338 211 347 218 351 L 246 351 C 249 347 248 340 243 336 Z' },
    { part: 'HINDLEG_NEAR', role: 'coat', d: 'M 398 206 C 436 206 456 230 452 260 C 449 278 436 290 428 300 L 432 340 L 414 342 L 408 304 C 398 292 390 274 390 254 Z' },
    { part: 'HINDPAW_NEAR', role: 'belly', d: 'M 432 336 L 412 336 C 400 338 398 347 405 351 L 436 351 C 439 347 438 340 432 336 Z' },
  ],
  decor: [
    { d: 'M 149 94 L 155 70 L 167 98', fill: '#e8a9a8' },
    { d: 'M 98 146 L 66 140 M 98 149 L 64 150 M 99 152 L 68 160', stroke: '#f4f1ea', w: 0.9 },
    { d: 'M 131 113 L 133 125', stroke: '#111', w: 2.2 },
  ],
  anchors: {
    HEAD: [148, 118, 18], MUZZLE: [114, 144, 10], NOSE: [100, 138, 5], MOUTH: [113, 156, 6], EYES: [132, 119, 6],
    EAR_NEAR: [158, 88, 9], EAR_FAR: [134, 84, 6], NECK: [180, 168, 14], CHEST: [238, 232, 24], ABDOMEN: [345, 232, 26],
    BACK: [310, 180, 26], RUMP: [440, 220, 20], TAIL: [532, 168, 10], PERINEUM: [463, 216, 5],
    FORELEG_NEAR: [233, 292, 10], FOREPAW_NEAR: [230, 344, 7], FORELEG_FAR: [258, 292, 9], FOREPAW_FAR: [254, 341, 6],
    HINDLEG_NEAR: [424, 262, 14], HINDPAW_NEAR: [420, 344, 7], HINDLEG_FAR: [400, 262, 12], HINDPAW_FAR: [400, 340, 6],
  },
  listOnly: ['SKIN', 'CONDITION'],
};

const HAMSTER: BodyModel = {
  w: 640, h: 370, texture: 'fur',
  torso: 'M 178 262 C 176 196 236 150 330 150 C 424 150 482 196 482 256 C 482 312 432 338 334 338 C 240 338 180 318 178 262 Z',
  shapes: [
    { part: 'FORELEG_FAR', role: 'pad', far: true, d: 'M 268 330 C 266 322 276 318 286 322 L 292 342 L 268 344 Z' },
    { part: 'HINDLEG_FAR', role: 'pad', far: true, d: 'M 404 326 C 404 316 420 312 430 318 L 436 342 L 404 344 Z' },
    { part: 'EAR_FAR', role: 'coat', far: true, d: 'M 226 178 C 222 162 236 154 246 162 C 252 170 246 182 236 184 Z' },
    { part: 'TAIL', role: 'skin', d: 'M 478 266 C 492 264 501 271 499 280 C 495 287 484 285 477 280 Z' },
    { part: 'HEAD', role: 'coat', clip: true, d: 'M 150 120 L 262 120 L 262 360 L 150 360 Z' },
    { part: 'BACK', role: 'coat', clip: true, d: 'M 262 120 L 430 120 L 430 236 L 262 236 Z' },
    { part: 'CHEST', role: 'belly', clip: true, d: 'M 262 236 L 330 236 L 330 360 L 262 360 Z' },
    { part: 'ABDOMEN', role: 'belly', clip: true, d: 'M 330 236 L 430 236 L 430 360 L 330 360 Z' },
    { part: 'RUMP', role: 'coat', clip: true, d: 'M 430 120 L 500 120 L 500 360 L 430 360 Z' },
    { part: 'PERINEUM', role: 'skin', d: 'M 468 290 C 477 289 483 298 479 307 C 471 310 465 301 468 290 Z' },
    { part: 'FLANK_GLANDS', role: 'coat', d: 'M 390 246 C 390 237 401 232 410 236 C 417 241 416 253 407 256 C 398 258 390 254 390 246 Z' },
    { part: 'CHEEK_POUCHES', role: 'belly', d: 'M 186 282 C 186 262 206 252 228 256 C 250 260 258 280 250 296 C 242 310 214 312 198 304 C 190 299 186 292 186 282 Z' },
    { part: 'NOSE', role: 'nose', d: 'M 171 258 C 171 251 179 248 185 252 C 188 256 186 264 180 266 C 175 266 171 263 171 258 Z' },
    { part: 'INCISORS', role: 'tooth', d: 'M 181 274 L 192 274 L 191 291 C 189 294 184 294 182 291 Z' },
    { part: 'EYES', role: 'eye', d: 'M 197 226 A 9 9 0 1 0 215 226 A 9 9 0 1 0 197 226 Z' },
    { part: 'EAR_NEAR', role: 'coat', d: 'M 244 172 C 240 152 262 144 272 158 C 278 170 268 184 256 186 Z' },
    { part: 'FORELEG_NEAR', role: 'pad', d: 'M 240 328 C 238 320 250 316 260 320 L 266 342 C 258 348 242 348 236 344 Z' },
    { part: 'HINDLEG_NEAR', role: 'pad', d: 'M 420 322 C 420 312 440 308 452 316 L 460 344 C 448 350 424 350 416 344 Z' },
  ],
  decor: [
    { d: 'M 249 170 C 248 160 260 156 265 163 C 268 170 262 178 255 179 Z', fill: '#e7a7a6' },
    { d: 'M 202 222 a 2.6 2.6 0 1 0 5.2 0 a 2.6 2.6 0 1 0 -5.2 0', fill: '#fff' },
    { d: 'M 176 262 L 140 254 M 176 266 L 138 268 M 178 270 L 142 282', stroke: '#6b5b4b', w: 0.8 },
    { d: 'M 237 345 l -2 3 M 243 347 l -2 3 M 249 347 l -2 3', stroke: '#b98a86', w: 1 },
  ],
  anchors: {
    HEAD: [222, 200, 20], NOSE: [179, 258, 5], INCISORS: [186, 284, 5], CHEEK_POUCHES: [222, 282, 16], EYES: [206, 226, 6],
    EAR_NEAR: [258, 168, 8], EAR_FAR: [236, 172, 6], BACK: [345, 190, 28], CHEST: [296, 290, 18], ABDOMEN: [380, 296, 20],
    RUMP: [455, 250, 16], FLANK_GLANDS: [403, 246, 7], TAIL: [489, 275, 6], PERINEUM: [474, 299, 5],
    FORELEG_NEAR: [251, 334, 7], FORELEG_FAR: [279, 333, 6], HINDLEG_NEAR: [438, 332, 9], HINDLEG_FAR: [420, 330, 7],
  },
  listOnly: ['SKIN', 'CONDITION'],
};

const TURTLE: BodyModel = {
  w: 640, h: 340, texture: 'scale',
  torso: 'M 190 246 C 194 162 288 110 370 110 C 456 110 530 162 536 240 C 538 252 528 258 518 256 L 206 258 C 196 258 189 254 190 246 Z',
  shapes: [
    { part: 'FORELIMB_FAR', role: 'scale', far: true, d: 'M 246 256 C 240 274 236 296 238 314 L 264 316 C 268 296 270 276 272 258 Z' },
    { part: 'HINDLIMB_FAR', role: 'scale', far: true, d: 'M 448 256 C 456 276 462 298 460 314 L 486 314 C 488 294 484 274 474 256 Z' },
    { part: 'TAIL', role: 'scale', d: 'M 530 236 C 552 242 568 254 576 262 C 560 263 544 258 526 252 Z' },
    { part: 'CLOACA', role: 'skin', d: 'M 524 249 C 531 246 538 251 536 258 C 529 261 523 256 524 249 Z' },
    { part: 'PLASTRON', role: 'plastron', d: 'M 206 254 L 520 254 C 516 272 500 282 480 282 L 240 282 C 222 282 210 272 206 254 Z' },
    { part: 'CARAPACE', role: 'shell', d: 'M 190 246 C 194 162 288 110 370 110 C 456 110 530 162 536 240 C 538 252 528 258 518 256 L 206 258 C 196 258 189 254 190 246 Z' },
    { part: 'NECK', role: 'scale', d: 'M 214 232 C 190 226 166 214 146 212 L 144 250 C 166 250 190 256 214 258 Z' },
    { part: 'HEAD', role: 'scale', d: 'M 92 214 C 94 192 122 184 148 196 C 162 204 162 238 148 248 C 128 258 98 250 92 234 Z' },
    { part: 'BEAK', role: 'beak', d: 'M 92 220 C 83 227 85 244 100 248 C 107 246 111 239 108 231 C 104 225 98 221 92 220 Z' },
    { part: 'EARS', role: 'scale2', d: 'M 133 224 A 7.5 7.5 0 1 0 148 224 A 7.5 7.5 0 1 0 133 224 Z' },
    { part: 'EYES', role: 'eye', d: 'M 109 207 A 7 7 0 1 0 123 207 A 7 7 0 1 0 109 207 Z' },
    { part: 'FORELIMB_NEAR', role: 'scale', d: 'M 214 254 C 204 272 196 298 198 318 L 230 320 C 236 298 240 276 244 258 Z' },
    { part: 'HINDLIMB_NEAR', role: 'scale', d: 'M 470 254 C 480 274 488 300 485 320 L 516 320 C 518 296 512 272 500 254 Z' },
  ],
  decor: [
    // scutes: the marginal ring, the vertebral row and the costal dividers
    { d: 'M 204 236 C 222 170 300 132 370 132 C 446 132 510 170 524 234', stroke: 'rgba(0,0,0,.35)', w: 2, clip: true },
    { d: 'M 300 140 C 334 124 408 124 440 142 M 290 150 L 282 234 M 370 132 L 370 236 M 452 148 L 462 234 M 330 132 L 328 236 M 412 134 L 416 236', stroke: 'rgba(0,0,0,.3)', w: 1.6, clip: true },
    { d: 'M 222 210 L 206 220 M 244 178 L 230 166 M 290 148 L 282 132 M 370 132 L 370 112 M 452 148 L 462 132 M 500 182 L 516 172 M 520 222 L 534 222', stroke: 'rgba(0,0,0,.3)', w: 1.4, clip: true },
    { d: 'M 240 258 L 240 280 M 300 258 L 300 282 M 370 258 L 370 282 M 440 258 L 440 282', stroke: 'rgba(0,0,0,.18)', w: 1.2 },
    // yellow stripes on head and neck (sliders and many terrapins)
    { d: 'M 100 236 C 120 240 140 236 156 228 M 150 232 C 176 236 196 240 212 244 M 112 196 C 124 192 136 194 146 200', stroke: '#e6cf5c', w: 2.2 },
    { d: 'M 113 205 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0', fill: '#fff' },
    { d: 'M 200 318 l -4 5 M 208 319 l -3 5 M 216 319 l -2 5 M 488 320 l -3 5 M 497 320 l -2 5 M 506 320 l -1 5', stroke: '#2e2a20', w: 1.6 },
  ],
  anchors: {
    HEAD: [130, 222, 14], BEAK: [98, 236, 7], EYES: [116, 207, 6], EARS: [141, 224, 6], NECK: [180, 236, 12],
    CARAPACE: [365, 190, 34], PLASTRON: [360, 268, 18], TAIL: [552, 252, 7], CLOACA: [530, 253, 5],
    FORELIMB_NEAR: [218, 292, 11], FORELIMB_FAR: [254, 290, 9], HINDLIMB_NEAR: [494, 290, 11], HINDLIMB_FAR: [468, 288, 9],
  },
  listOnly: ['SKIN', 'CONDITION'],
};

const BIRD: BodyModel = {
  w: 640, h: 410, texture: 'feather',
  torso: 'M 268 128 C 228 140 212 200 222 252 C 232 302 268 332 308 332 C 344 332 362 302 356 260 C 350 200 318 132 268 128 Z',
  shapes: [
    { part: 'WING_FAR', role: 'coat', far: true, d: 'M 318 134 C 362 150 386 214 382 276 C 380 318 390 352 404 380 C 380 372 360 340 346 300 L 330 220 Z' },
    { part: 'TAIL', role: 'coat', d: 'M 326 312 C 342 346 360 388 374 404 L 394 398 C 380 366 364 330 352 302 Z' },
    { part: 'CROP', role: 'face', clip: true, d: 'M 180 130 L 272 130 L 272 205 L 180 205 Z' },
    { part: 'KEEL', role: 'belly', clip: true, d: 'M 180 205 L 290 205 L 290 276 L 180 276 Z' },
    { part: 'ABDOMEN', role: 'belly', clip: true, d: 'M 180 276 L 400 276 L 400 360 L 180 360 Z' },
    { part: 'BACK', role: 'coat', clip: true, d: 'M 272 100 L 400 100 L 400 276 L 290 276 L 290 205 L 272 205 Z' },
    { part: 'PREEN_GLAND', role: 'skin', d: 'M 343 300 C 349 295 358 299 356 307 C 350 312 342 308 343 300 Z' },
    { part: 'VENT', role: 'skin', d: 'M 305 326 C 311 321 322 323 322 331 C 316 336 306 334 305 326 Z' },
    { part: 'HEAD', role: 'face', d: 'M 230 104 C 230 74 254 58 282 60 C 312 62 326 90 318 118 C 312 140 290 150 268 148 C 245 146 230 128 230 104 Z' },
    { part: 'BEAK', role: 'beak', d: 'M 238 94 C 218 92 203 107 207 126 C 211 141 222 143 226 132 C 225 122 232 115 243 116 Z' },
    { part: 'CERE', role: 'cere', d: 'M 227 92 C 231 85 241 85 245 92 C 241 99 231 100 227 92 Z' },
    { part: 'EYES', role: 'eye', d: 'M 251 97 A 7 7 0 1 0 265 97 A 7 7 0 1 0 251 97 Z' },
    { part: 'WING_NEAR', role: 'coat', d: 'M 298 140 C 344 150 370 212 368 270 C 366 320 378 356 394 384 C 360 370 330 330 312 292 C 296 256 286 200 298 140 Z' },
    { part: 'LEG_FAR', role: 'pad', far: true, d: 'M 300 328 L 312 328 L 314 345 L 302 345 Z' },
    { part: 'LEG_NEAR', role: 'pad', d: 'M 282 324 L 296 324 L 298 345 L 284 345 Z' },
    { part: 'FOOT_FAR', role: 'pad', far: true, d: 'M 296 345 C 294 353 302 359 322 355 L 330 351 C 322 343 308 341 296 345 Z' },
    { part: 'FOOT_NEAR', role: 'pad', d: 'M 270 345 C 268 353 276 359 300 355 L 312 350 C 304 342 288 340 270 345 Z' },
  ],
  decor: [
    // the perch, then feather rows on the wing and the cheek spot
    { d: 'M 150 352 L 470 352 C 476 352 476 366 470 366 L 150 366 C 144 366 144 352 150 352 Z', fill: '#8a6240' },
    { d: 'M 306 170 q 14 8 28 2 M 304 196 q 18 10 36 2 M 306 222 q 20 10 40 2 M 312 248 q 20 10 42 2 M 320 274 q 20 10 40 2 M 330 300 q 18 10 36 2 M 342 326 q 14 8 30 2', stroke: 'rgba(0,0,0,.28)', w: 1.4 },
    { d: 'M 330 330 L 372 392 M 340 324 L 384 394', stroke: 'rgba(0,0,0,.22)', w: 1.2 },
    { d: 'M 255 96 a 2.2 2.2 0 1 0 4.4 0 a 2.2 2.2 0 1 0 -4.4 0', fill: '#fff' },
    { d: 'M 252 128 a 6 5 0 1 0 12 0 a 6 5 0 1 0 -12 0', fill: '#3d5bb5' },
  ],
  anchors: {
    HEAD: [284, 100, 16], BEAK: [218, 120, 8], CERE: [236, 92, 5], EYES: [258, 97, 6], CROP: [242, 178, 14],
    KEEL: [246, 240, 16], ABDOMEN: [288, 302, 14], BACK: [318, 170, 14], WING_NEAR: [338, 250, 18], WING_FAR: [372, 230, 12],
    TAIL: [362, 362, 10], PREEN_GLAND: [350, 303, 5], VENT: [314, 328, 5], LEG_NEAR: [290, 334, 5], LEG_FAR: [307, 336, 4],
    FOOT_NEAR: [290, 350, 6], FOOT_FAR: [314, 350, 5],
  },
  listOnly: ['FEATHERS', 'CONDITION'],
};

export const BODY_MODELS: Record<BodyAnimal, BodyModel> = { DOG, CAT, HAMSTER, TURTLE, BIRD };

/** '_NEAR' / '_FAR' → '_R' / '_L' for the side shown. */
export function resolvePart(part: string, side: BodySide): string {
  const far = side === 'R' ? 'L' : 'R';
  return part.replace(/_NEAR$/, `_${side}`).replace(/_FAR$/, `_${far}`);
}
/** 'FORELEG_R' → { base: 'FORELEG', side: 'R' }. */
export function splitPart(part: string): { base: string; side: BodySide | null } {
  const m = part.match(/^(.*)_(R|L)$/);
  return m ? { base: m[1], side: m[2] as BodySide } : { base: part, side: null };
}
/** Every part of a species, in the order of the parts list (both sides of paired parts). */
export function bodyParts(a: BodyAnimal): string[] {
  const m = BODY_MODELS[a];
  const out: string[] = [];
  for (const s of m.shapes) {
    const r = resolvePart(s.part, 'R');
    const l = resolvePart(s.part, 'L');
    for (const p of r === l ? [r] : [r, l]) if (!out.includes(p)) out.push(p);
  }
  // Head to tail, right before left, whole-body items last.
  const rank = (p: string) => {
    const { base, side } = splitPart(p);
    const i = ORDER.indexOf(base);
    return (i < 0 ? ORDER.length : i) * 2 + (side === 'L' ? 1 : 0);
  };
  return [...out.sort((x, y) => rank(x) - rank(y)), ...m.listOnly];
}
const ORDER = [
  'HEAD', 'MUZZLE', 'NOSE', 'BEAK', 'CERE', 'INCISORS', 'CHEEK_POUCHES', 'MOUTH', 'EYES', 'EAR', 'EARS', 'NECK', 'CROP', 'CHEST',
  'KEEL', 'BACK', 'ABDOMEN', 'FLANK_GLANDS', 'RUMP', 'CARAPACE', 'PLASTRON', 'WING', 'FORELEG', 'FOREPAW', 'FORELIMB', 'HINDLEG',
  'HINDPAW', 'HINDLIMB', 'LEG', 'FOOT', 'TAIL', 'PREEN_GLAND', 'PERINEUM', 'CLOACA', 'VENT',
];

// ---------------------------------------------------------------- findings per kind of part
const GENERAL = ['NORMAL', 'WOUND', 'LUMP', 'SWELLING', 'PAIN', 'REDNESS', 'HAIR_LOSS', 'PARASITES', 'DISCHARGE', 'ITCHING', 'SCAR'];
const FEATHERED = ['NORMAL', 'WOUND', 'LUMP', 'SWELLING', 'PAIN', 'FEATHER_LOSS', 'PLUCKING', 'STRESS_BARS', 'PARASITES', 'SCAR'];
const SCALY = ['NORMAL', 'WOUND', 'LUMP', 'SWELLING', 'REDNESS', 'RETAINED_SHED', 'DISCHARGE', 'SCAR'];
const ORIFICE = ['NORMAL', 'DISCHARGE', 'SWELLING', 'REDNESS', 'LUMP', 'PARASITES', 'SOILING', 'PROLAPSE'];

export function bodyConditions(a: BodyAnimal, part: string): string[] {
  const { base } = splitPart(part);
  if (base === 'CONDITION') return ['NORMAL', 'UNDERWEIGHT', 'OVERWEIGHT', 'OBESE', 'DEHYDRATED'];
  if (base === 'SKIN') return a === 'TURTLE' ? ['NORMAL', 'RETAINED_SHED', 'FUNGAL', 'WOUND', 'LUMP', 'REDNESS'] : ['NORMAL', 'HAIR_LOSS', 'ITCHING', 'DRY_SCALY', 'RASH', 'PARASITES', 'LUMP', 'WOUND'];
  if (base === 'FEATHERS') return ['NORMAL', 'FEATHER_LOSS', 'PLUCKING', 'STRESS_BARS', 'PARASITES', 'DULL'];
  if (base === 'EYES') return ['NORMAL', 'DISCHARGE', 'SWELLING', 'REDNESS', 'CLOUDY', 'WOUND'];
  if (base === 'NOSE') return ['NORMAL', 'DISCHARGE', 'DRY_CRACKED', 'WOUND', 'SWELLING'];
  if (base === 'MOUTH') return ['NORMAL', 'WOUND', 'LUMP', 'SWELLING', 'DROOLING', 'BAD_BREATH'];
  if (base === 'INCISORS') return ['NORMAL', 'OVERGROWN', 'BROKEN', 'MISALIGNED'];
  if (base === 'BEAK') return ['NORMAL', 'OVERGROWN', 'BROKEN', 'FLAKING', ...(a === 'TURTLE' ? [] : ['DISCOLOURED'])];
  if (base === 'CERE') return ['NORMAL', 'DISCHARGE', 'BROWN_HYPERTROPHY', 'SWELLING'];
  if (base === 'CHEEK_POUCHES') return ['NORMAL', 'IMPACTED', 'SWELLING', 'WOUND'];
  if (base === 'CROP') return ['NORMAL', 'CROP_STASIS', 'SWELLING', 'WOUND', 'BURN'];
  if (base === 'CARAPACE' || base === 'PLASTRON') return ['NORMAL', 'SHELL_ROT', 'PYRAMIDING', 'SOFT_SHELL', 'CRACK', 'SCUTE_LOSS', 'WOUND'];
  if (base === 'EARS' && a === 'TURTLE') return ['NORMAL', 'ABSCESS', 'SWELLING'];
  if (base === 'EAR') return [...GENERAL, 'OTITIS', 'MITES'];
  if (base === 'CLOACA' || base === 'VENT' || base === 'PERINEUM') return a === 'HAMSTER' ? [...ORIFICE, 'WET_TAIL'] : ORIFICE;
  if (base === 'TAIL' && a === 'HAMSTER') return [...GENERAL, 'WET_TAIL'];
  if (base === 'FLANK_GLANDS' || base === 'PREEN_GLAND') return ['NORMAL', 'SWELLING', 'LUMP', 'REDNESS', 'DISCHARGE'];
  if (base === 'FOOT') return ['NORMAL', 'BUMBLEFOOT', 'OVERGROWN_NAILS', 'SWELLING', 'WOUND', 'LAMENESS'];
  if (base === 'WING') return [...FEATHERED, 'FRACTURE', 'DROOPING'];
  if (base === 'LEG') return ['NORMAL', 'WOUND', 'SWELLING', 'FRACTURE', 'LAMENESS', 'BAND_TIGHT'];
  if (base === 'KEEL') return [...FEATHERED, 'PROMINENT_KEEL'];
  if (a === 'BIRD') return FEATHERED;
  if (base === 'FORELIMB' || base === 'HINDLIMB') return [...SCALY, 'FRACTURE', 'OVERGROWN_NAILS', 'LAMENESS'];
  if (a === 'TURTLE') return SCALY;
  if (base === 'FORELEG' || base === 'HINDLEG') return [...GENERAL, 'FRACTURE', 'LAMENESS', ...(a === 'HAMSTER' ? ['OVERGROWN_NAILS'] : [])];
  if (base === 'FOREPAW' || base === 'HINDPAW') return [...GENERAL, 'OVERGROWN_NAILS', 'LAMENESS'];
  if (base === 'ABDOMEN') return [...GENERAL, 'DISTENDED', 'HERNIA'];
  return GENERAL;
}
/** These replace every other finding on the part. */
export const BODY_EXCLUSIVE = ['UNDERWEIGHT', 'OVERWEIGHT', 'OBESE'];

/** "How it looks": a tint over the part. */
export const BODY_SHADES: Record<string, string> = {
  RED: '#d64545', BRUISED: '#6f3f86', PALE: '#f3e3dc', YELLOW: '#e3c43c', DARK: '#2e2a2a', SWOLLEN: '#e88d8d',
};

// ---------------------------------------------------------------- colours
/** The coat / plumage / shell colour from the pet's "Colour" text (English or Arabic); the second colour named
 *  (e.g. "Black & tan") becomes the belly and legs. */
const WORDS: [RegExp, string][] = [
  [/black|أسود|اسود/i, '#2b2624'], [/white|أبيض|ابيض/i, '#f1eee8'], [/cream|كريمي|بيج|beige/i, '#e7d4b0'],
  [/gold|ذهبي/i, '#d39f4d'], [/yellow|أصفر|اصفر|lutino/i, '#e9cc4c'], [/fawn|tan|sandy|برونزي/i, '#c8955a'],
  [/chocolate|brown|liver|بني/i, '#7a5034'], [/ginger|orange|red|برتقالي|أحمر|احمر|مشمشي/i, '#c8743a'],
  [/silver|فضي/i, '#b8b8b4'], [/grey|gray|blue|رمادي|أزرق|ازرق/i, '#8f8e8c'], [/green|أخضر|اخضر|olive|زيتوني/i, '#6fae45'],
  [/tabby|تابي/i, '#9a8466'], [/brindle/i, '#6a4b33'], [/tortoise|calico|شيرازي/i, '#7e5a3a'],
];
const BIRD_BLUE: [RegExp, string] = [/blue|أزرق|ازرق/i, '#5d8fd8'];
const DEFAULTS: Record<BodyAnimal, [string, string]> = {
  DOG: ['#c8955a', '#e2bf8e'], CAT: ['#8f8e8c', '#d6d2cb'], HAMSTER: ['#d49a55', '#f3ece2'],
  TURTLE: ['#5f5a34', '#d7c58a'], BIRD: ['#6fae45', '#ead45a'],
};
function coloursIn(text: string, a: BodyAnimal): string[] {
  const table = a === 'BIRD' ? [BIRD_BLUE, ...WORDS] : WORDS;
  const hits: { at: number; hex: string }[] = [];
  for (const [re, hex] of table) {
    const m = text.match(re);
    if (m && m.index != null && !hits.some((h) => h.hex === hex)) hits.push({ at: m.index, hex });
  }
  return hits.sort((x, y) => x.at - y.at).map((h) => h.hex);
}

export interface Palette { [role: string]: string }
export function bodyPalette(a: BodyAnimal, colorText: string | null | undefined, irisHex: string): Palette {
  const found = coloursIn(colorText ?? '', a);
  const [d1, d2] = DEFAULTS[a];
  const coat = found[0] ?? d1;
  const second = found[1] ?? (found[0] ? mixHex(coat, '#f4efe6', coat === '#2b2624' ? 0.15 : 0.35) : d2);
  // A bird's body is one colour; the second colour (or yellow) is its face and throat.
  const belly = a === 'BIRD' ? coat : second;
  const p: Palette = {
    coat, belly, face: a === 'BIRD' ? (found[1] ?? d2) : coat, skin: '#e6aaa6', nose: a === 'DOG' ? '#2a2222' : '#de9aa2', lip: a === 'DOG' ? shadeHex(second, -0.35) : '#c98a8f',
    pad: a === 'DOG' || a === 'CAT' ? shadeHex(belly, -0.1) : a === 'BIRD' ? '#b7a39d' : '#efb9b6', eye: irisHex, tooth: '#e9b45a',
    beak: a === 'TURTLE' ? '#3f3a2a' : '#efe3c4', cere: '#c9b28d',
    shell: a === 'TURTLE' ? coat : '#5f5a34', plastron: '#d7c58a', scale: a === 'TURTLE' ? '#6b7a40' : '#6b7a40', scale2: '#8a9a55',
  };
  if (a === 'TURTLE') { p.shell = coat; p.scale = found[1] ?? '#6b7a40'; }
  return p;
}

/** A part's name in the UI language: species-specific wording first (e.g. a bird's "Back"), then the general one. */
export function bodyPartName(t: (k: string) => string, a: BodyAnimal, part: string): string | null {
  if (part === 'NOTES') return t('body.general');
  const { base, side } = splitPart(part);
  const key = side ? `body.part.${base}_${side}` : `body.part.${base}`;
  const special = `body.part.${a}_${side ? `${base}_${side}` : base}`;
  const s1 = t(special);
  if (s1 !== special) return s1;
  const s2 = t(key);
  return s2 === key ? null : s2;
}
