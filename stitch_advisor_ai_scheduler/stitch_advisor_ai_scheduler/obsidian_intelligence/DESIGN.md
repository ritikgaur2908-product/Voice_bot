---
name: Obsidian Intelligence
colors:
  surface: '#10131a'
  surface-dim: '#10131a'
  surface-bright: '#363941'
  surface-container-lowest: '#0b0e15'
  surface-container-low: '#191b23'
  surface-container: '#1d2027'
  surface-container-high: '#272a31'
  surface-container-highest: '#32353c'
  on-surface: '#e1e2ec'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#e1e2ec'
  inverse-on-surface: '#2e3038'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#ddb7ff'
  on-secondary: '#490080'
  secondary-container: '#6f00be'
  on-secondary-container: '#d6a9ff'
  tertiary: '#ffb786'
  on-tertiary: '#502400'
  tertiary-container: '#df7412'
  on-tertiary-container: '#461f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#f0dbff'
  secondary-fixed-dim: '#ddb7ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6900b3'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb786'
  on-tertiary-fixed: '#311400'
  on-tertiary-fixed-variant: '#723600'
  background: '#10131a'
  on-background: '#e1e2ec'
  surface-variant: '#32353c'
typography:
  headline-xl:
    fontFamily: Outfit
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Outfit
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Outfit
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-max: 1200px
  gutter: 16px
  safe-margin: 20px
---

## Brand & Style

The design system is centered on a high-end, futuristic aesthetic that positions the product as an elite digital concierge. It targets high-performance professionals who value efficiency and state-of-the-art technology. 

The visual style is a refined **Glassmorphism**, emphasizing depth through transparency and light refraction rather than traditional skeuomorphism. The interface should feel like a pane of dark obsidian suspended in a void of ambient light. Subtle radial glows in deep blues and purples should emanate from the background to provide a sense of atmospheric energy without distracting from the content. The overall mood is calm, authoritative, and technologically advanced.

## Colors

The color palette is built on a "Deep Midnight" foundation to minimize eye strain and maximize the impact of vibrant accents. 

- **Primary (Electric Blue):** Used for critical actions, user message bubbles, and primary interactive states.
- **Secondary (Deep Purple):** Primarily used in gradients and background radial glows to add depth.
- **Success (Neon Emerald):** Reserved for confirmation states, completed bookings, and available time slots.
- **Backgrounds:** A strict gradient from #0a0d14 to #111827 to create a subtle sense of verticality.
- **Active Voice State:** A dynamic linear gradient of Electric Blue (#3b82f6), Deep Purple (#a855f7), and Cyan (#22d3ee).

## Typography

This design system utilizes a dual-font approach. **Outfit** is used for headlines to provide a modern, geometric, and premium feel. **Inter** is used for all body text, labels, and system-level information to ensure maximum legibility at small sizes and within translucent containers.

High contrast in font weight is encouraged to establish clear hierarchy. Use "label-sm" for metadata and section headers, ensuring the uppercase styling provides a distinct architectural break in the layout.

## Layout & Spacing

The layout follows a fluid-grid model with high internal padding within components to maintain the "airy" feel of glass. 

- **Desktop:** 12-column grid with a maximum container width of 1200px.
- **Mobile:** Single column with 20px safe margins.
- **Spacing Rhythm:** Based on a 4px baseline. Use 16px (md) for most gutters and 24px (lg) for vertical section spacing.

The chat interface should be center-aligned on desktop with a maximum width of 800px to maintain focus, while components like the Top Bar and Input Bar remain pinned to their respective screen edges.

## Elevation & Depth

Depth is achieved through a three-tier system:

1.  **Base Layer:** The solid #0a0d14 background with soft radial gradients (blurs of 120px-200px) in secondary colors.
2.  **Surface Layer (Glass):** UI elements use a background of `rgba(255, 255, 255, 0.05)` and a `backdrop-filter: blur(16px)`. A thin 1px border of `rgba(255, 255, 255, 0.08)` is required to define the edges of the glass.
3.  **Active/Hover Layer:** Elements increase in brightness (`rgba(255, 255, 255, 0.1)`) and gain a subtle outer glow using the primary electric blue color (0px 8px 24px rgba(59, 130, 246, 0.15)).

Avoid solid shadows; use luminosity and border-definitions to create separation.

## Shapes

The design system uses a "Rounded" (8px) base for most structural components like cards and chat bubbles. 

Specific overrides for interaction-heavy elements:
- **Input Bar:** 32px (Pill-shaped) to distinguish it as the primary interaction focal point.
- **Microphone/Action Buttons:** Full circle (rounded-full).
- **Selection Chips:** Pill-shaped for a tactile, friendly feel.

## Components

### Chat Message Bubbles
- **User:** Solid Electric Blue (#3b82f6) background, white text. Right-aligned.
- **AI:** Frosted glass styling (translucent surface, 16px blur) with a 1px border. Left-aligned.

### Interactive Booking Cards
- Glass background with increased blur (24px).
- **Glowing Buttons:** Primary buttons within cards feature a 2px inner glow and a 12px outer drop shadow using the primary color at 30% opacity.

### Bottom Input Bar
- Floating 32px-radius bar with frosted glass styling.
- Internal elements (text fields) are borderless with a darker `rgba(0,0,0,0.2)` inset background.

### Microphone Button
- Circular button with a primary color gradient.
- **Animation States:**
  - *Idle:* Steady pulse (1.0 to 1.05 scale).
  - *Listening:* Multi-layered rings expanding outwards with varying opacities.
  - *Processing:* Rotating gradient border.

### Top Bar
- Minimalist height (64px).
- Full-width glass effect with no bottom border; use a slight backdrop-filter and a linear gradient mask to transition into the main background.