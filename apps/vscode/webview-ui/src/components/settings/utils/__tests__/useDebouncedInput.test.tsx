import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebouncedInput } from "../useDebouncedInput"

describe("useDebouncedInput", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not call onChange for the initial value", () => {
		const onChange = vi.fn()
		renderHook(() => useDebouncedInput("initial", onChange, 100))

		act(() => {
			vi.advanceTimersByTime(100)
		})

		expect(onChange).not.toHaveBeenCalled()
	})

	it("does not call onChange when initialValue changes externally", () => {
		const onChange = vi.fn()
		const { rerender } = renderHook(({ initialValue }) => useDebouncedInput(initialValue, onChange, 100), {
			initialProps: { initialValue: "initial" },
		})

		rerender({ initialValue: "external" })
		act(() => {
			vi.advanceTimersByTime(100)
		})

		expect(onChange).not.toHaveBeenCalled()
	})

	it("calls onChange after local edits", () => {
		const onChange = vi.fn()
		const { result } = renderHook(() => useDebouncedInput("initial", onChange, 100))

		act(() => {
			result.current[1]("edited")
		})
		act(() => {
			vi.advanceTimersByTime(100)
		})

		expect(onChange).toHaveBeenCalledWith("edited")
	})
})
