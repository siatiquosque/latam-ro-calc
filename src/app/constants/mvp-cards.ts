// Cards that drop from an MVP (the MVP's own card, e.g. Carta Tao Gunka), not cards of ordinary monsters used to kill an MVP.
// The dataset carries no drop tables, so this was derived by matching each card name to an MVP of constants/mvp.ts and then
// adding, by hand, the cards whose name differs from the monster's (Howard/Harword, Ferlock, Flamel, Fenrir/Fenris, Selada,
// Miragem). When a card is in doubt it is listed: excluding one card too many is safer than recommending a card the player
// cannot get. Used by the optimizer, the item search and `validate_build` (`mvpCards`).
export const MVP_CARD_IDS: ReadonlySet<number> = new Set([
  4121, 4123, 4128, 4131, 4132, 4134, 4135, 4137, 4142, 4143, 4144, 4145,
  4146, 4147, 4148, 4168, 4236, 4263, 4276, 4302, 4305, 4318, 4324, 4330,
  4342, 4352, 4357, 4359, 4361, 4363, 4365, 4367, 4372, 4374, 4376, 4386,
  4399, 4403, 4407, 4408, 4419, 4425, 4430, 4441, 4451, 4457, 4502, 4505,
  4507, 4520, 4525, 4526, 4527, 4528, 4529, 4534, 4556, 4557, 4560, 4561,
  4562, 4563, 4564, 4565, 4566, 4574, 4576, 4578, 4580, 4590, 4591, 4592,
  4601, 4602, 4603, 4604, 4610, 4625, 4635, 4636, 4648, 4649, 4651, 4652,
  4662, 4671, 4672, 4673, 4674, 4675, 4676, 4677, 4678, 4679, 4680, 4681,
  4682, 4683, 4697, 27020, 27025, 27081, 27104, 27106, 27113, 27119, 27126, 27150,
  27151, 27152, 27162, 27164, 27180, 27182, 27211, 27265, 27287, 27294, 27298, 27305,
  27318, 27319, 27321, 27326, 27327, 27329, 27334, 27346, 27362, 27363, 27381, 27383,
  31023, 31026, 300007, 300013, 300014, 300021, 300078, 300079, 300080, 300099, 300100, 300107,
  300145, 300151, 300239, 300248, 300262, 300266, 300280, 300281,
]);
