import { moderateText } from "./filter.js";

const samples = [
  "привет",
  "секс",
  "сekс",
  "с е к с",
  "c.e.k.c",
  "п*о*р*н*о",
  "н-а-ц-и-з-м",
  "идиот",
  "нацизм",
  "white power",
  "t.me/test"
];

for (const sample of samples) {
  console.log(sample, "=>", JSON.stringify(moderateText(sample)));
}
