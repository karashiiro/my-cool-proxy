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
	<div class="section-header flex items-center gap-2 border-b border-border px-4 py-2.5">
		<svg class="size-3.5 text-primary/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<polyline points="16 18 22 12 16 6" />
			<polyline points="8 6 2 12 8 18" />
		</svg>
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Script</h2>
		{#if script}
			<span class="ml-auto font-mono text-[10px] text-muted-foreground/50">
				{script.split("\n").length} lines
			</span>
		{/if}
	</div>
	{#if !script}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<svg class="size-8 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<polyline points="16 18 22 12 16 6" />
				<polyline points="8 6 2 12 8 18" />
			</svg>
			<span class="text-xs text-muted-foreground">Select an execution to view its script</span>
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
	.section-header {
		background: linear-gradient(
			180deg,
			oklch(0.17 0.015 260) 0%,
			oklch(0.15 0.012 260) 100%
		);
	}

	.code-viewer :global(pre) {
		margin: 0;
		padding: 0.75rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		background: oklch(0.11 0.01 260) !important;
		border: 1px solid oklch(0.2 0.012 260);
	}

	.code-viewer :global(.line) {
		padding: 0 0.25rem;
	}

	.code-viewer :global(.tool-call-btn) {
		cursor: pointer;
		border-radius: 0.25rem;
		padding: 0 0.2rem;
		margin: 0 -0.1rem;
		transition: all 150ms ease;
		text-decoration: underline;
		text-decoration-color: oklch(0.78 0.145 70 / 0.4);
		text-underline-offset: 3px;
		text-decoration-thickness: 1.5px;
	}

	.code-viewer :global(.tool-call-btn:hover) {
		background: oklch(0.78 0.145 70 / 0.1);
		text-decoration-color: oklch(0.78 0.145 70 / 0.8);
		box-shadow: 0 0 8px -2px oklch(0.78 0.145 70 / 0.2);
	}
</style>
