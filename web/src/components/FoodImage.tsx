import { useState } from "react";

// Shows the item's photo when it has one; otherwise a clean emoji tile so cards never look empty.
const emojiRules: Array<[RegExp, string]> = [
  [/pizza/i, "🍕"],
  [/burger/i, "🍔"],
  [/spaghetti|pasta|carbonara|noodle/i, "🍝"],
  [/salmon|fish/i, "🐟"],
  [/prawn|shrimp/i, "🍤"],
  [/soup/i, "🍲"],
  [/bruschetta|bread/i, "🥖"],
  [/tiramisu|cake|dessert|ice/i, "🍰"],
  [/lemon/i, "🍋"],
  [/espresso|coffee/i, "☕"],
  [/drink|juice|cola/i, "🥤"],
  [/salad/i, "🥗"],
  [/steak|beef|grill/i, "🥩"],
];

export const emojiFor = (name: string, fallback = "🍽️") => emojiRules.find(([re]) => re.test(name))?.[1] ?? fallback;

export function FoodImage({
  src,
  name,
  fallback,
  className = "",
}: {
  src: string | null | undefined;
  name: string;
  fallback?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img src={src} alt={name} loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  }
  return (
    <div
      role="img"
      aria-label={name}
      className={`flex items-center justify-center bg-gradient-to-br from-stone-100 via-red-50 to-amber-50 text-5xl ${className}`}
    >
      {emojiFor(name, fallback)}
    </div>
  );
}
