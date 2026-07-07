import { useEffect, useRef, useState } from "react"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

/**
 * A custom hook that provides debounced input handling to prevent jumpy text inputs
 * when saving changes directly to backend on every keystroke.
 *
 * @param initialValue - The initial value for the input
 * @param onChange - Callback function to save the value (e.g., to backend)
 * @param debounceMs - Debounce delay in milliseconds (default: 500ms)
 * @returns A tuple of [currentValue, setValue] similar to useState
 */
export function useDebouncedInput<T>(
	initialValue: T,
	onChange: (value: T) => void,
	debounceMs: number = 100,
): [T, (value: T) => void] {
	// Local state to prevent jumpy input - initialize once
	const [localValue, setLocalValueState] = useState(initialValue)

	// Track previous initialValue to detect external changes
	const prevInitialValueRef = useRef<T>(initialValue)
	const hasLocalEditRef = useRef(false)

	// Sync local state when initialValue changes externally (e.g., when switching Plan/Act tabs)
	useEffect(() => {
		if (prevInitialValueRef.current !== initialValue) {
			hasLocalEditRef.current = false
			setLocalValueState(initialValue)
			prevInitialValueRef.current = initialValue
		}
	}, [initialValue])

	// Debounced backend save - saves after user stops changing value
	useDebounceEffect(
		() => {
			if (!hasLocalEditRef.current) {
				return
			}
			hasLocalEditRef.current = false
			onChange(localValue)
		},
		debounceMs,
		[localValue],
	)

	const setLocalValue = (value: T) => {
		hasLocalEditRef.current = true
		setLocalValueState(value)
	}

	return [localValue, setLocalValue]
}
