import { randomInt, randomUUID } from 'node:crypto';
// The first choice is correct in this private seed bank. Never serve this module as static content.
export const bank = [
  ['Which city is the main setting of Friends?', 'New York City', 'Chicago', 'Seattle', 'Boston'],
  ['What is the name of the paper company in The Office (US)?', 'Dunder Mifflin', 'Pied Piper', 'Waystar Royco', 'Initech'],
  ['Who created The Simpsons?', 'Matt Groening', 'Seth MacFarlane', 'Mike Judge', 'Trey Parker'],
  ['Which fictional continent is home to the Seven Kingdoms in Game of Thrones?', 'Westeros', 'Middle-earth', 'Narnia', 'Pandora'],
  ['What is the name of the parallel dimension in Stranger Things?', 'The Upside Down', 'The Twilight Zone', 'The Bad Place', 'The Matrix'],
  ['Walter White teaches which subject in Breaking Bad?', 'Chemistry', 'History', 'Physics', 'Mathematics'],
  ['What is the name of the Doctor’s time machine in Doctor Who?', 'TARDIS', 'Enterprise', 'Serenity', 'Millennium Falcon'],
  ['Which series features the character Jean-Luc Picard?', 'Star Trek: The Next Generation', 'Doctor Who', 'Firefly', 'The Expanse'],
  ['What kind of animal is Bluey?', 'Dog', 'Cat', 'Rabbit', 'Koala'],
  ['Which television award is represented by a winged woman holding an atom?', 'Emmy', 'Oscar', 'Grammy', 'Tony'],
  ['Sherlock Holmes lives on which London street?', 'Baker Street', 'Fleet Street', 'Downing Street', 'Oxford Street'],
  ['What is the name of the coffee shop in Friends?', 'Central Perk', 'Monk’s Café', 'Luke’s Diner', 'Café Nervosa'],
  ['Which country produced the original Squid Game?', 'South Korea', 'Japan', 'Thailand', 'China'],
  ['Which series features the Roy family?', 'Succession', 'Modern Family', 'The Crown', 'Downton Abbey'],
  ['What is the first episode of a proposed TV series often called?', 'Pilot', 'Finale', 'Sequel', 'Crossover'],
  ['Which fictional town is the main setting of Stranger Things?', 'Hawkins', 'Springfield', 'Riverdale', 'Twin Peaks'],
  ['Which show features Ted, Robin, Marshall, Lily and Barney?', 'How I Met Your Mother', 'Friends', 'New Girl', 'Community'],
  ['What is the fictional police precinct in Brooklyn Nine-Nine?', '99th', '21st', '12th', '51st'],
  ['Which series is set mainly in the fictional town of Winden?', 'Dark', 'Lost', 'Westworld', 'Severance'],
  ['Who plays the title character in Ted Lasso?', 'Jason Sudeikis', 'Steve Carell', 'Bill Hader', 'Andy Samberg'],
  ['Which series follows the employees of Lumon Industries?', 'Severance', 'The Office', 'Silicon Valley', 'Superstore'],
  ['Which fantasy series features Aang?', 'Avatar: The Last Airbender', 'Adventure Time', 'Gravity Falls', 'Steven Universe'],
  ['Which family lives at 742 Evergreen Terrace?', 'The Simpsons', 'The Griffins', 'The Belchers', 'The Flintstones'],
  ['Which BBC documentary series was first released in 2006 with David Attenborough narrating?', 'Planet Earth', 'Blue Planet II', 'Our Planet', 'Frozen Planet'],
];
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function makeQuiz() {
  const key = {};
  const questions = shuffle(bank).slice(0, 5).map(([text, ...options]) => {
    const id = randomUUID();
    const choices = options.map((text, i) => { const choice = { id: randomUUID(), text }; if (!i) key[id] = choice.id; return choice; });
    return { id, text, choices: shuffle(choices) };
  });
  return { id: randomUUID(), questions, key };
}
