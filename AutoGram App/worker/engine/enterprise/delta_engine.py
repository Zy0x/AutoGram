class Range:
    def __init__(self, start, end):
        self.start = start
        self.end = end

class ResumePlan:
    def __init__(self):
        self.preserved_ranges = []
        self.deleted_sequences = set()
        self.decision_queue = []
        self.new_ranges = []
        self.notes = []

    def preserve_range(self, start, end):
        self.preserved_ranges.append(Range(start, end))

    def mark_source_deleted(self, sequence_id):
        self.deleted_sequences.add(sequence_id)

    def add_note(self, note):
        self.notes.append(note)

    def queue_for_decision(self, edited_message):
        self.decision_queue.append(edited_message)

    def append_new_range(self, new_range):
        self.new_ranges.append(new_range)

    def rebuild_dependencies(self):
        # Placeholder for dependency graph rebuild
        pass

class DeltaEngine:
    def merge(self, checkpoint, changes):
        plan = ResumePlan()
        
        last_committed = getattr(checkpoint, 'last_committed_sequence', 0)

        # 1. Preserve all processed messages (VERIFIED status)
        if last_committed > 0:
            plan.preserve_range(1, last_committed)

        # 2. Handle deleted messages in processed range
        if hasattr(changes, 'deleted_messages_list'):
            for deleted in changes.deleted_messages_list:
                if deleted.sequence_id <= last_committed:
                    # Mark as SOURCE_DELETED in mapping table
                    plan.mark_source_deleted(deleted.sequence_id)
                    # Do NOT attempt to re-send
                    plan.add_note(f"Message {deleted.sequence_id} deleted at source")

        # 3. Handle edited messages in processed range
        if hasattr(changes, 'edited_messages_list'):
            for edited in changes.edited_messages_list:
                if edited.sequence_id <= last_committed:
                    # User choice: Skip edit, Overwrite, or Smart Sync
                    plan.queue_for_decision(edited)

        # 4. Append new messages beyond checkpoint
        if changes.new_messages_detected:
            new_range = Range(
                start=last_committed + 1,
                end=last_committed + changes.new_message_count
            )
            plan.append_new_range(new_range)

        # 5. Rebuild dependency graph with new information
        plan.rebuild_dependencies()

        return plan
