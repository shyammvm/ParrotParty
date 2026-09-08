import React from 'react';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #f97316, #ea580c)', // Warm orange
  'linear-gradient(135deg, #3b82f6, #1d4ed8)', // Royal blue
  'linear-gradient(135deg, #10b981, #059669)', // Emerald green
  'linear-gradient(135deg, #8b5cf6, #6d28d9)', // Violet
  'linear-gradient(135deg, #ec4899, #be185d)', // Vibrant pink
  'linear-gradient(135deg, #06b6d4, #0e7490)', // Teal / cyan
  'linear-gradient(135deg, #f59e0b, #d97706)', // Amber gold
  'linear-gradient(135deg, #ef4444, #b91c1c)', // Crimson red
  'linear-gradient(135deg, #14b8a6, #0f766e)', // Jade
  'linear-gradient(135deg, #6366f1, #4338ca)', // Indigo
];

/**
 * Returns the first letter or initials from a player's name.
 * e.g. "Shyam" -> "S", "John Doe" -> "JD", "DJ" -> "DJ"
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (trimmed.length <= 2) {
    return trimmed.toUpperCase();
  }
  return trimmed[0].toUpperCase();
}

/**
 * Returns a consistent gradient color based on the player's name.
 */
export function getAvatarColor(name) {
  if (!name) return AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
}

/**
 * Clean round avatar displaying the player's initial(s) with an automatic vibrant gradient.
 */
export function PlayerAvatar({ name, avatar, size = 36, fontSize, style = {}, className = '' }) {
  const letters = avatar || getInitials(name);
  const bg = getAvatarColor(name || letters);
  const computedFontSize = fontSize || `${Math.max(10, Math.round(size * 0.44))}px`;

  return (
    <div
      className={`player-avatar-badge ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        fontSize: computedFontSize,
        background: bg,
        ...style
      }}
      title={name || letters}
    >
      {letters}
    </div>
  );
}
