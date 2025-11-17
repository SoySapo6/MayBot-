import settings from '../settings.json' with { type: 'json' };

export function applyFont(text, fontType) {
    const fontMap = new Map();
    const normalLetters = settings.fonts.letters.split(' ');
    const targetLetters = settings.fonts[fontType].split(' ');

    normalLetters.forEach((letter, index) => {
        fontMap.set(letter, targetLetters[index]);
    });

    return text.toLowerCase().split('').map(char => fontMap.get(char) || char).join('');
}

export function getRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
}
