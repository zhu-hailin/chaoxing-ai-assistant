    // 当前章节的字幕、讲义与画面材料接入。
    const chapterContextCache = new WeakMap();
    function chapterContextIdentity(doc) {
        const owner=studyOwnerDocument(doc),chapterId=owner&&(courseStudyContext(owner).chapterId||owner.querySelector('#curChapterId')?.value);
        const scope=owner && courseScoreKey(owner);
        return owner && scope && chapterId ? {owner,chapterId:String(chapterId),id:`${scope}:${chapterId}`} : null;
    }
    function chapterContextStore(doc) {
        const identity=chapterContextIdentity(doc);if(!identity)return null;
        let store=chapterContextCache.get(identity.owner);
        if(store?.chapterId!==identity.id){store=createCourseContext(identity.id);chapterContextCache.set(identity.owner,store);}
        return {identity,store};
    }
    function captureCurrentCourseContext(doc, options={}) {
        const currentIdentity=chapterContextIdentity(doc);
        if(!currentIdentity || options.expectedIdentity && options.expectedIdentity!==currentIdentity.id)return [];
        const documents=courseFrameTree(currentIdentity.owner).documents;
        if(options.video && (!options.video.isConnected || !documents.includes(options.video.ownerDocument)))return [];
        if(options.reader && (!options.reader.node?.isConnected || !documents.includes(options.reader.doc)))return [];
        const record=chapterContextStore(doc);if(!record)return [];
        const {identity,store}=record;
        const append=values=>mergeCourseContext(store,identity.id,collectCourseContext({chapterId:identity.id,...values}));
        if(options.video)append({video:options.video});
        if(options.reader)append({reader:options.reader});
        if(!options.video && !options.reader)for(const current of documents) {
            for(const video of current.querySelectorAll('video'))append({video});
            const reader=courseDocumentReader(current);if(reader)append({reader});
        }
        // 仅采集带明确章节身份的资料区域，不扫描答案区或任意页面正文。
        const notesRoots=documents.flatMap(current=>[...current.querySelectorAll('[data-course-notes][data-chapter-id]')])
            .filter(root=>root.getAttribute('data-chapter-id')===identity.chapterId);
        if(notesRoots.length)append({notesRoots});
        return courseContextForPrompt(store,identity.id);
    }
