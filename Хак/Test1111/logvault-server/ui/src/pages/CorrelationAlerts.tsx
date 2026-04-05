// Алерты корреляции (инциденты) теперь находятся в разделе "Инциденты"
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
export default function CorrelationAlerts() {
  const navigate = useNavigate();
  useEffect(() => { navigate("/incidents", { replace: true }); }, [navigate]);
  return null;
}
