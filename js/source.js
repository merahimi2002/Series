new WOW().init();


document.addEventListener("DOMContentLoaded", function () {
    const button = document.querySelector('.first-button');
    button.addEventListener('click', function () {
        const icon = this.querySelector('.animated-icon1');
        icon.classList.toggle('open');
    });
});

// change color

const toggleTheme = document.getElementById('ThemeBoxSwitchInput');

toggleTheme.addEventListener('change', function () {
    const root = document.documentElement;

    if (this.checked) {
        // DarkMode
        root.style.setProperty('--white-custome', '0, 0, 0');
        root.style.setProperty('--black-custome', '255, 255, 255');

    } else {
        // Light Mode
        root.style.setProperty('--white-custome', '255, 255, 255');
        root.style.setProperty('--black-custome', '0, 0, 0');
    }
});


function changeColor() {
    const root = document.documentElement;
    root.style.setProperty('--first-color', '0, 0, 102');
    root.style.setProperty('--second-color', '213, 49, 61');
}

function changeColor01() {
    const root = document.documentElement;
    root.style.setProperty('--first-color', '34, 154, 149');
    root.style.setProperty('--second-color', '255, 162, 0');
}

// CustomColorPicker

const firstInput = document.getElementById('firstColorInput');
const secondInput = document.getElementById('secondColorInput');

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}

firstInput.addEventListener('input', () => {
    const rgb = hexToRgb(firstInput.value);
    document.documentElement.style.setProperty('--first-color', rgb);
});

secondInput.addEventListener('input', () => {
    const rgb = hexToRgb(secondInput.value);
    document.documentElement.style.setProperty('--second-color', rgb);
});


// Entry point for the table app. Keeps global footprint minimal.
(async function () {
    try {

       
            const fileInputContainer = document.getElementById('fileInputContainer');
            if (fileInputContainer) {
                fileInputContainer.style.display = 'block';
            }

            const notice = document.createElement('div');
        

        if (typeof init !== 'function') {
            throw new Error('init() not found. Make sure js/data.js loads before js/main.js.');
        }
        await init({ rowsPerPage: 10 });
    } catch (err) {
        console.error('Failed to initialize table app:', err);
    }
})();

