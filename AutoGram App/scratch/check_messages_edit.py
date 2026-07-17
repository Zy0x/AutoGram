try:
    from telethon.tl.functions.messages import EditForumTopicRequest
    print("Found in messages:", EditForumTopicRequest)
    import inspect
    print("Signature:", inspect.signature(EditForumTopicRequest.__init__))
except ImportError as e:
    print("Import failed:", e)
