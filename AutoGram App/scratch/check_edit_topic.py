import sys
try:
    from telethon.tl.functions.channels import EditForumTopicRequest
    print("Found EditForumTopicRequest:", EditForumTopicRequest)
    import inspect
    print("Signature:", inspect.signature(EditForumTopicRequest.__init__))
except ImportError as e:
    print("Import failed:", e)
