// The ToyFoundry mark: a crayon stroke that resolves into a solid form.
// The whole product in one glyph — the child's line on the left, the
// object it becomes on the right.

export function Mark({ size = 30 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox='0 0 32 32' fill='none' aria-hidden='true'>
            <defs>
                <linearGradient id='tf-mark' x1='0' y1='0' x2='32' y2='32' gradientUnits='userSpaceOnUse'>
                    <stop stopColor='#6C4CF1' />
                    <stop offset='1' stopColor='#F5476B' />
                </linearGradient>
            </defs>
            <rect width='32' height='32' rx='9' fill='url(#tf-mark)' />
            <path
                d='M8 22.5c0-6 2.4-9.6 5-9.6 2 0 2.6 1.8 1.5 3.4-1 1.5-2.7 1-2.7-.8 0-2.6 3-5 5.6-5'
                stroke='white'
                strokeWidth='1.9'
                strokeLinecap='round'
                opacity='0.9'
            />
            <circle cx='21.5' cy='13' r='3.6' fill='white' />
            <rect x='17.6' y='17' width='7.8' height='6' rx='2.4' fill='white' />
        </svg>
    )
}
