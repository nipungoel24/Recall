"use client";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useRouter } from "next/navigation"
import { routes } from "@/lib/routes";




export const useNavigation = (meetingId: string, meetingTitle: string) => {
    const router = useRouter();
    const { setCurrentMeeting } = useSidebar();

    const handleNavigation = () => {
        setCurrentMeeting({ id: meetingId, title: meetingTitle });
        router.push(routes.meeting(meetingId));
    };

    return handleNavigation;
};

