import { describe, expect, test } from "bun:test";
import { greetingKey } from "../src/lawoss/lite/pages/today-page";

// #543: v noci stránka Dnes zdravila „Dobré ráno“.
describe("pozdrav na stránke Dnes podľa hodiny (#543)", () => {
  test.each([0, 1, 4])("o %i:00 v noci večerný pozdrav", (hour) => {
    expect(greetingKey(hour)).toBe("greeting_evening");
  });
  test.each([5, 9])("o %i:00 ráno", (hour) => {
    expect(greetingKey(hour)).toBe("greeting_morning");
  });
  test.each([10, 17])("o %i:00 cez deň", (hour) => {
    expect(greetingKey(hour)).toBe("greeting_day");
  });
  test.each([18, 23])("o %i:00 večer", (hour) => {
    expect(greetingKey(hour)).toBe("greeting_evening");
  });
});
