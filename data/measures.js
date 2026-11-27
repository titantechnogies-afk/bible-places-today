/* JUST ONE MORE LORD — Bible money, weights and measures in today's terms.
   Money is measured in days' wages, because a denarius was a labourer's pay for one day (Matthew 20:2); the app turns days
   into rand using a daily wage the reader can change. Default: South Africa's national minimum wage from 1 March 2026,
   R30.23 an hour x 8 hours = R241.84 a day (Department of Employment and Labour, Government Gazette 54075).
   Other values are scholars' usual estimates; ancient units varied by time and place, so treat them as approximate.
   money fields: id, n (name), s (Strong's), d (value in days' wages), w (what it is), r (references).
   units fields: id, n, s, v (metric value), u (unit: m | kg | l), w, r. stories: [title, days' wages, text, ref]. */
window.JOM_MEASURES = {
wage: 241.84, wageNote: 'South Africa\'s national minimum wage for an 8-hour day since 1 March 2026 (R30.23 an hour).',
money: [
  { id: 'lepton', n: 'Lepton (the widow\'s mite)', s: 'G3016', d: 1 / 128, w: 'The smallest copper coin. The widow gave two lepta, worth a quadrans: about 1/64 of a day\'s wage, "all she had to live on".', r: ['Mark 12:41-44', 'Luke 21:1-4'] },
  { id: 'quadrans', n: 'Quadrans (kodrantes)', s: 'G2835', d: 1 / 64, w: 'A small Roman bronze coin, worth two lepta. "You will not get out until you have paid the last penny."', r: ['Matthew 5:26', 'Mark 12:42'] },
  { id: 'assarion', n: 'Assarion', s: 'G787', d: 1 / 16, w: 'A copper coin. Two sparrows sold for one, yet not one falls without your Father: "you are worth more than many sparrows."', r: ['Matthew 10:29-31', 'Luke 12:6-7'] },
  { id: 'denarius', n: 'Denarius', s: 'G1220', d: 1, w: 'A silver Roman coin: one day\'s wage for a labourer. It carried Caesar\'s image ("Give to Caesar what is Caesar\'s").', r: ['Matthew 20:2', 'Matthew 22:19-21', 'Luke 10:35'] },
  { id: 'drachma', n: 'Drachma', s: 'G1406', d: 1, w: 'A Greek silver coin worth about a denarius. The woman in the parable searched her whole house for one lost drachma.', r: ['Luke 15:8-10'] },
  { id: 'didrachma', n: 'Didrachma (half-shekel temple tax)', s: 'G1323', d: 2, w: 'Two drachmas: the yearly temple tax each Jewish man paid.', r: ['Matthew 17:24', 'Exodus 30:13'] },
  { id: 'stater', n: 'Stater (shekel)', s: 'G4715', d: 4, w: 'A silver coin worth four drachmas, enough to pay the temple tax for two. Peter found one in a fish\'s mouth.', r: ['Matthew 17:27'] },
  { id: 'thirty-silver', n: 'Thirty pieces of silver', s: 'G694', d: 120, w: 'The price paid to Judas, probably shekels (tetradrachms): about four months\' wages. Zechariah prophesied the price, and it was the legal value of a slave (Exodus 21:32).', r: ['Matthew 26:15', 'Zechariah 11:12-13', 'Exodus 21:32'] },
  { id: 'mina', n: 'Mina (pound)', s: 'G3414', d: 100, w: 'One hundred drachmas: over three months\' wages. In the parable of the minas each servant received one.', r: ['Luke 19:13-25'] },
  { id: 'talent', n: 'Talent', s: 'G5007', d: 6000, w: 'A weight of silver equal to about 6,000 denarii: roughly 20 years of a labourer\'s wages.', r: ['Matthew 25:14-30', 'Matthew 18:24'] }
],
stories: [
  ['The Good Samaritan\'s payment', 2, 'The Samaritan gave the innkeeper two denarii for the injured man\'s care and promised to pay any more on his way back.', 'Luke 10:35'],
  ['Bread for the five thousand', 200, 'Philip said 200 denarii would not buy enough bread for each person to have a little.', 'John 6:7'],
  ['Mary\'s perfume', 300, 'The perfume Mary poured on Jesus was worth more than 300 denarii: about a year\'s wages, given in love.', 'Mark 14:3-5'],
  ['What the fellow servant owed', 100, 'The unforgiving servant choked a man who owed him 100 denarii.', 'Matthew 18:28'],
  ['What the king forgave', 60000000, 'The king forgave 10,000 talents: about 60 million days\' wages, a debt no one could ever repay. That is what you have been forgiven.', 'Matthew 18:24-27'],
  ['The magicians\' books in Ephesus', 50000, 'New believers burned their magic books worth 50,000 pieces of silver (drachmas).', 'Acts 19:19']
],
length: [
  { id: 'finger', n: 'Finger (digit)', s: 'H676', v: 0.0185, u: 'm', w: 'The width of a finger: about 1.9 cm.', r: ['Jeremiah 52:21'] },
  { id: 'handbreadth', n: 'Handbreadth', s: 'H2947', v: 0.074, u: 'm', w: 'The width of four fingers: about 7.4 cm.', r: ['Exodus 25:25', 'Psalm 39:5'] },
  { id: 'span', n: 'Span', s: 'H2239', v: 0.222, u: 'm', w: 'From thumb to little finger with the hand spread: half a cubit, about 22 cm.', r: ['Exodus 28:16', 'Isaiah 40:12'] },
  { id: 'cubit', n: 'Cubit', s: 'H520', v: 0.445, u: 'm', w: 'From the elbow to the tip of the middle finger: about 44.5 cm (a longer "royal" cubit was about 52 cm).', r: ['Genesis 6:15', 'Exodus 25:10', 'Matthew 6:27'] },
  { id: 'fathom', n: 'Fathom', s: 'G3712', v: 1.85, u: 'm', w: 'The span of outstretched arms: about 1.85 m. Paul\'s sailors measured the sea\'s depth in fathoms.', r: ['Acts 27:28'] },
  { id: 'reed', n: 'Reed (measuring rod)', s: 'H7070', v: 3.1, u: 'm', w: 'Six long cubits: about 3.1 m, used in Ezekiel\'s and John\'s visions of the temple and the city.', r: ['Ezekiel 40:5', 'Revelation 21:15-16'] },
  { id: 'stadion', n: 'Stadion (furlong)', s: 'G4712', v: 185, u: 'm', w: 'About 185 m. Emmaus was 60 stadia (about 11 km) from Jerusalem; the disciples had rowed 25 to 30 stadia (about 5 km) when Jesus came walking on the water.', r: ['Luke 24:13', 'John 6:19', 'John 11:18'] },
  { id: 'sabbath-journey', n: 'A Sabbath day\'s journey', s: '', v: 900, u: 'm', w: 'The distance allowed on the Sabbath by later Jewish custom: 2,000 cubits, about 900 m. The Mount of Olives was this far from Jerusalem.', r: ['Acts 1:12'] },
  { id: 'mile', n: 'Mile (Roman)', s: 'G3400', v: 1480, u: 'm', w: 'A thousand paces: about 1.48 km. "If anyone forces you to go one mile, go with him two."', r: ['Matthew 5:41'] },
  { id: 'days-journey', n: 'A day\'s journey', s: '', v: 32000, u: 'm', w: 'How far people usually walked in a day: about 30 to 35 km.', r: ['Luke 2:44', 'Numbers 11:31'] }
],
weight: [
  { id: 'gerah', n: 'Gerah', s: 'H1626', v: 0.00057, u: 'kg', w: 'One twentieth of a shekel: about 0.57 g.', r: ['Exodus 30:13'] },
  { id: 'beka', n: 'Beka (half shekel)', s: 'H1235', v: 0.0057, u: 'kg', w: 'Half a shekel: about 5.7 g. Every Israelite counted in the census gave a beka of silver for the tabernacle.', r: ['Exodus 38:26', 'Genesis 24:22'] },
  { id: 'shekel', n: 'Shekel', s: 'H8255', v: 0.0114, u: 'kg', w: 'The standard weight for silver and gold: about 11.4 g. Abraham paid 400 shekels of silver (about 4.6 kg) for the cave of Machpelah.', r: ['Genesis 23:15-16', 'Jeremiah 32:9'] },
  { id: 'litra', n: 'Litra (Roman pound)', s: 'G3046', v: 0.327, u: 'kg', w: 'About 327 g. Mary\'s perfume was a litra of pure nard; Nicodemus brought about 100 litrai (about 33 kg) of myrrh and aloes for Jesus\' burial.', r: ['John 12:3', 'John 19:39'] },
  { id: 'mina-weight', n: 'Mina (weight)', s: 'H4488', v: 0.57, u: 'kg', w: 'Fifty shekels: about 570 g (Ezekiel gives a mina of 60 shekels).', r: ['Ezekiel 45:12', 'Ezra 2:69'] },
  { id: 'talent-weight', n: 'Talent (weight)', s: 'H3603', v: 34, u: 'kg', w: 'Three thousand shekels: about 34 kg, roughly what a man could carry. The gold lampstand of the tabernacle used one talent of pure gold.', r: ['Exodus 25:39', 'Exodus 38:25-26', 'Revelation 16:21'] }
],
volume: [
  { id: 'log', n: 'Log', s: 'H3849', v: 0.31, u: 'l', w: 'The smallest liquid measure: about 0.3 litres, a cup of oil.', r: ['Leviticus 14:10'] },
  { id: 'choinix', n: 'Choinix (quart)', s: 'G5518', v: 1.1, u: 'l', w: 'About 1.1 litres, a day\'s ration of grain.', r: ['Revelation 6:6'] },
  { id: 'omer', n: 'Omer', s: 'H6016', v: 2.2, u: 'l', w: 'A tenth of an ephah: about 2.2 litres, the daily portion of manna for each person.', r: ['Exodus 16:16-18', 'Exodus 16:36'] },
  { id: 'hin', n: 'Hin', s: 'H1969', v: 3.7, u: 'l', w: 'About 3.7 litres of oil or wine.', r: ['Exodus 29:40', 'Ezekiel 4:11'] },
  { id: 'seah', n: 'Seah (measure)', s: 'H5429', v: 7.3, u: 'l', w: 'A third of an ephah: about 7.3 litres. Three seahs of flour, about 22 litres, is the amount in the parable of the yeast and in Abraham\'s meal for his visitors.', r: ['Genesis 18:6', 'Matthew 13:33'] },
  { id: 'modios', n: 'Modios (bushel basket)', s: 'G3426', v: 8.7, u: 'l', w: 'About 8.7 litres, the basket you do not hide your lamp under.', r: ['Matthew 5:15'] },
  { id: 'ephah', n: 'Ephah (dry) / bath (liquid)', s: 'H374', v: 22, u: 'l', w: 'About 22 litres. Ruth gleaned about an ephah of barley in one day.', r: ['Ruth 2:17', 'Ezekiel 45:11'] },
  { id: 'metretes', n: 'Metretes (firkin)', s: 'G3355', v: 39, u: 'l', w: 'About 39 litres. Each of the six stone jars at Cana held two or three metretes: 470 to 700 litres of wine in all.', r: ['John 2:6'] },
  { id: 'homer', n: 'Homer / kor', s: 'H2563', v: 220, u: 'l', w: 'Ten ephahs: about 220 litres, a donkey-load.', r: ['Ezekiel 45:11', 'Luke 16:7'] }
],
famous: [
  ['Noah\'s ark', '300 × 50 × 30 cubits', 'About 134 m long, 22 m wide and 13 m high: longer than a rugby field, with three decks.', 'Genesis 6:15'],
  ['The ark of the covenant', '2½ × 1½ × 1½ cubits', 'About 1.1 m long and 67 cm wide and high.', 'Exodus 25:10'],
  ['Goliath', 'six cubits and a span', 'About 2.9 m in the Hebrew text; the Dead Sea Scrolls and the Greek Old Testament say four cubits and a span, about 2 m.', '1 Samuel 17:4'],
  ['Solomon\'s temple', '60 × 20 × 30 cubits', 'The main building was about 27 m long, 9 m wide and 13 m high.', '1 Kings 6:2'],
  ['Emmaus road', '60 stadia', 'About 11 km: a walk of two to three hours, during which Jesus explained all the Scriptures about himself.', 'Luke 24:13-27'],
  ['The miraculous catch', '200 cubits from shore', 'The disciples were about 90 m from the beach when Jesus called to them.', 'John 21:8']
]
};
