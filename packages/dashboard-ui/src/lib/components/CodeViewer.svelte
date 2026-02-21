<script lang="ts">
	import { highlightLua } from "$lib/highlight.js";
	import type { LuaToolCall } from "$lib/types.js";

	let {
		script,
		toolCalls,
		ontoolcallclick,
	}: {
		script: string;
		toolCalls: LuaToolCall[];
		ontoolcallclick?: (toolCall: LuaToolCall | null) => void;
	} = $props();

	let highlightedHtml = $state("");

	$effect(() => {
		// Read reactive deps synchronously before any async work
		const currentScript = script;
		const currentToolCalls = toolCalls;

		if (!currentScript) {
			highlightedHtml = "";
			return;
		}

		// Cancellation flag to prevent stale async results from overwriting
		let cancelled = false;
		highlightLua(currentScript, currentToolCalls).then((html) => {
			if (!cancelled) {
				highlightedHtml = html;
			}
		});

		return () => {
			cancelled = true;
		};
	});

	function handleClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		const toolCallBtn = target.closest<HTMLElement>(".tool-call-btn");

		if (toolCallBtn) {
			const callId = toolCallBtn.dataset.callId;
			const tc = toolCalls.find((t) => t.callId === callId);
			ontoolcallclick?.(tc ?? null);
		} else {
			ontoolcallclick?.(null);
		}
	}
</script>

<div class="flex h-full flex-col">
	<div class="border-b border-border px-3 py-2">
		<h2 class="text-sm font-semibold text-foreground">Script</h2>
	</div>
	{#if !script}
		<div class="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
			Select an execution to view its script
		</div>
	{:else}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="code-viewer flex-1 overflow-auto p-2 text-sm"
			onclick={handleClick}
		>
			{@html highlightedHtml}
		</div>
	{/if}
</div>

<style>
	.code-viewer :global(pre) {
		margin: 0;
		padding: 0.75rem;
		border-radius: 0.375rem;
		overflow-x: auto;
	}

	.code-viewer :global(.tool-call-btn) {
		cursor: pointer;
		border-radius: 0.25rem;
		padding: 0 0.125rem;
		transition: background-color 150ms;
		text-decoration: underline;
		text-decoration-color: oklch(0.556 0 0 / 0.5);
		text-underline-offset: 2px;
	}

	.code-viewer :global(.tool-call-btn:hover) {
		background-color: oklch(0.265 0 0);
	}
</style>
